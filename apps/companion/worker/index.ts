import { asc } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { stations } from '../src/db/schema'
import { APP_VERSION } from '../src/lib/app-version'
import { formatUserCode } from '../src/lib/device-code'
import { ingestPayloadSchema, replaceLapsSchema } from '../src/lib/session-payload'
import { watchPayloadSchema } from '../src/lib/watch-payload'
import { deleteAccount } from './account'
import { createAuth, currentUserId } from './auth'
import { createDb } from './db'
import {
    approveLink,
    describePending,
    deviceForToken,
    listDevices,
    markDeviceSeen,
    openLinkRequest,
    pollLink,
    renameDevice,
    revokeDevice,
} from './devices'
import { ingestSession, ingestWatchSession } from './session-ingest'
import {
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    deleteSession,
    getSession,
    listSessions,
    replaceLaps,
} from './sessions'
import { getStats } from './stats'

// `Env` is generated from wrangler.jsonc by `npm run cf-typegen`
// (worker-configuration.d.ts) and carries the bindings.
type LinkedDevice = { id: string; userId: string; product: string | null }

const app = new Hono<{
    Bindings: Env
    Variables: { userId: string; device: LinkedDevice }
}>()

// Everything under /api needs a session except these: the auth endpoints
// themselves (you can't be signed in while signing in), the liveness check and the
// build number, neither of which says anything about anyone's data, and the two
// device-pairing routes.
//
// The pairing pair are anonymous by construction — a watch has no cookie yet, and
// obtaining one is the entire point of the flow. Neither returns anything of
// value until a signed-in human has approved the code: the poll answers
// `authorization_pending` to anyone, and the code request only ever mints a
// code that is useless on its own. Exact matches, not a `/api/device/` prefix,
// so `approve` and `pending` stay behind the session.
const PUBLIC_PATHS = new Set([
    '/api/health',
    '/api/version',
    '/api/device/code',
    '/api/device/token',
])

function isPublic(pathname: string) {
    return PUBLIC_PATHS.has(pathname) || pathname.startsWith('/api/auth/')
}

// The one route a device token can reach. A token grants exactly one capability
// — ingest, for its owner — so bearer auth is scoped to this path rather than
// accepted anywhere a cookie would be. There is no fallback in either direction:
// a cookie is not a substitute for a linked watch, and a token is not a
// substitute for a session.
const DEVICE_INGEST_PATH = '/api/sessions/watch'

// Registered before any route, so a route added later is guarded by default
// rather than by remembering to guard it. The session is resolved once here and
// handed to handlers, rather than each one re-reading it.
app.use('/api/*', async (c, next) => {
    const { pathname } = new URL(c.req.url)
    if (isPublic(pathname)) {
        return next()
    }

    if (pathname === DEVICE_INGEST_PATH) {
        const bearer = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1]
        const device = bearer == null ? null : await deviceForToken(createDb(c.env.DB), bearer)
        if (device == null) {
            // Unknown, revoked and malformed all answer the same. This is the
            // one status the watch treats as terminal (§3.6).
            return c.json({ error: 'unauthorized' }, 401)
        }
        c.set('userId', device.userId)
        c.set('device', device)
        return next()
    }

    const userId = await currentUserId(c.env, c.req.raw.headers)
    if (userId == null) {
        return c.json({ error: 'unauthorized' }, 401)
    }
    c.set('userId', userId)
    await next()
})

// better-auth owns its own routes: sign-in, magic-link verification, sign-out,
// session. It reads the raw request, so Hono just hands it over.
app.on(['GET', 'POST'], '/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw))

const nowSeconds = () => Math.floor(Date.now() / 1000)

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

// Range bounds are ISO — `2026-07-01` or a full date-time — and become the unix
// seconds the rows are stored in. A bare date means the whole of that day in UTC,
// inclusive at both ends, so `from=2026-07-01&to=2026-07-31` is all of July as a
// date picker would mean it.
function isoBoundary(endOfDay: boolean) {
    return z.string().transform((value, ctx) => {
        const iso = DATE_ONLY.test(value)
            ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
            : value
        const ms = Date.parse(iso)
        if (Number.isNaN(ms)) {
            ctx.addIssue({
                code: 'custom',
                message: 'Expected an ISO date (2026-07-01) or date-time',
            })
            return z.NEVER
        }
        return Math.floor(ms / 1000)
    })
}

// Query params arrive as strings or not at all; coerce and bound them here so the
// handlers get real values. An out-of-range limit is a 400 rather than a silent
// clamp — better to tell the caller than to quietly return a different page.
const listQuerySchema = z
    .object({
        limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
        offset: z.coerce.number().int().nonnegative().default(0),
        from: isoBoundary(false).optional(),
        to: isoBoundary(true).optional(),
        // Stays cost an extra query, so they are opt-in — but one query for the
        // page, never one per session.
        include: z.literal('intervals').optional(),
    })
    .refine((q) => q.from == null || q.to == null || q.from <= q.to, {
        message: '`from` must not be after `to`',
        path: ['from'],
    })

// Same bounds as the list, and required rather than optional: a total is only
// meaningful next to the period it covers, so the caller has to say which.
const statsQuerySchema = z
    .object({ from: isoBoundary(false), to: isoBoundary(true) })
    .refine((q) => q.from <= q.to, {
        message: '`from` must not be after `to`',
        path: ['from'],
    })

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// The build this Worker was deployed from. Public, and the only way to tell what is
// live without opening the app. The client bundle carries the same value — they
// ship as one deploy — so the two can't disagree.
app.get('/api/version', (c) => c.json({ version: APP_VERSION }))

const linkRequestSchema = z.object({
    installId: z.string().min(1).max(128),
    product: z.string().min(1).max(64).nullish(),
})

const pollSchema = z.object({ deviceCode: z.string().min(1).max(128) })

const approveSchema = z.object({ userCode: z.string().min(1).max(32) })
// Long enough for "Sarah's vívoactive in the blue case", short enough that the
// list stays a list.
const renameSchema = z.object({ name: z.string().max(60) })

// A watch asking to be linked. Anonymous: it has no credential yet, and the code
// it gets back is worthless until a signed-in human approves it (§2.1).
app.post('/api/device/code', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = linkRequestSchema.safeParse(body)
    if (!parsed.success) {
        return c.json({ error: 'invalid_payload', issues: parsed.error.issues }, 400)
    }

    const result = await openLinkRequest(
        createDb(c.env.DB),
        { installId: parsed.data.installId, product: parsed.data.product ?? null },
        nowSeconds(),
    )
    return c.json({ ...result, userCode: formatUserCode(result.userCode) }, 201)
})

// The watch asking whether anyone has approved it yet. The polling states carry
// RFC 8628's vocabulary but ride on a 200: this is the normal path, hit every
// five seconds by every linking watch, and 400s would bury real errors.
app.post('/api/device/token', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = pollSchema.safeParse(body)
    if (!parsed.success) {
        return c.json({ error: 'invalid_payload', issues: parsed.error.issues }, 400)
    }

    const result = await pollLink(createDb(c.env.DB), parsed.data.deviceCode, nowSeconds())
    return c.json(result, 200)
})

// What is asking, so the confirmation screen can name the watch before the user
// commits. Never returns the device code.
app.get('/api/device/pending/:code', async (c) => {
    const pending = await describePending(createDb(c.env.DB), c.req.param('code'), nowSeconds())
    if (pending == null) {
        return c.json({ error: 'not_found' }, 404)
    }
    return c.json(pending)
})

// The one step that needs a human. Binds the pending code to this account.
app.post('/api/device/approve', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = approveSchema.safeParse(body)
    if (!parsed.success) {
        return c.json({ error: 'invalid_payload', issues: parsed.error.issues }, 400)
    }

    const approved = await approveLink(
        createDb(c.env.DB),
        parsed.data.userCode,
        c.get('userId'),
        nowSeconds(),
    )
    if (!approved) {
        // Expired, already used, or never existed — all the same to the caller,
        // so a wrong guess learns nothing about which.
        return c.json({ error: 'not_found' }, 404)
    }
    return c.json({ status: 'approved' })
})

app.get('/api/devices', async (c) => {
    const rows = await listDevices(createDb(c.env.DB), c.get('userId'))
    return c.json({ devices: rows })
})

app.patch('/api/devices/:id', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = renameSchema.safeParse(body)
    if (!parsed.success) {
        return c.json({ error: 'invalid_payload', issues: parsed.error.issues }, 400)
    }

    const renamed = await renameDevice(
        createDb(c.env.DB),
        c.get('userId'),
        c.req.param('id'),
        parsed.data.name,
    )
    if (!renamed) {
        return c.json({ error: 'not_found' }, 404)
    }
    return c.body(null, 204)
})

app.delete('/api/devices/:id', async (c) => {
    const revoked = await revokeDevice(
        createDb(c.env.DB),
        c.get('userId'),
        c.req.param('id'),
        nowSeconds(),
    )
    if (!revoked) {
        return c.json({ error: 'not_found' }, 404)
    }
    return c.body(null, 204)
})

// The station catalogue: the closed set of labels the watch can write, with the
// thermal class each one counts towards. Seeded by migration, so this is a read.
app.get('/api/stations', async (c) => {
    const db = createDb(c.env.DB)
    const rows = await db
        .select({
            id: stations.id,
            name: stations.name,
            thermalClass: stations.thermalClass,
            isTransition: stations.isTransition,
        })
        .from(stations)
        .orderBy(asc(stations.id))
    return c.json({ stations: rows })
})

// Ingest one parsed session. The FIT itself never reaches the Worker — the client
// parses it and posts the result (§1).
app.post('/api/sessions', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = ingestPayloadSchema.safeParse(body)
    if (!parsed.success) {
        return c.json({ error: 'invalid_payload', issues: parsed.error.issues }, 400)
    }

    const result = await ingestSession(createDb(c.env.DB), c.get('userId'), parsed.data)
    if (result.status === 'duplicate') {
        // Not a failure: the user re-dropped a file they already imported.
        return c.json({ status: 'duplicate', id: result.id }, 409)
    }
    if (result.status === 'merged') {
        // The visit was already here from the watch; this filled in what only
        // the FIT carries. Not a new session, so not a 201.
        return c.json({ status: 'merged', id: result.id }, 200)
    }
    return c.json({ status: 'created', id: result.id }, 201)
})

// A session the watch posts as you end it. Authenticated by the device token
// rather than a cookie, and answering §3.6's contract: a re-send from the
// watch's offline queue is a 200, not a duplicate error, because retrying is
// normal operation.
app.post('/api/sessions/watch', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = watchPayloadSchema.safeParse(body)
    if (!parsed.success) {
        return c.json({ error: 'invalid_payload', issues: parsed.error.issues }, 400)
    }

    const db = createDb(c.env.DB)
    const device = c.get('device')
    const result = await ingestWatchSession(db, c.get('userId'), device, parsed.data)

    // Only on an accepted payload, so a rejected request costs no write.
    await markDeviceSeen(db, device.id, nowSeconds())

    return c.json(result, result.status === 'created' ? 201 : 200)
})

// The user's sessions, newest first, optionally bounded by an ISO date range.
// Summary rows by default; `include=intervals` brings the stays too, so a period
// view doesn't need a call per session.
app.get('/api/sessions', async (c) => {
    const query = listQuerySchema.safeParse({
        limit: c.req.query('limit'),
        offset: c.req.query('offset'),
        from: c.req.query('from'),
        to: c.req.query('to'),
        include: c.req.query('include'),
    })
    if (!query.success) {
        return c.json({ error: 'invalid_query', issues: query.error.issues }, 400)
    }

    const { limit, offset, from, to, include } = query.data
    const rows = await listSessions(createDb(c.env.DB), c.get('userId'), {
        limit,
        offset,
        from,
        to,
        includeIntervals: include === 'intervals',
    })
    return c.json({ sessions: rows, limit, offset })
})

// Totals over a period: time by thermal class, where it went, and whether the
// habit is holding. Summed in SQL — see stats.ts.
app.get('/api/stats', async (c) => {
    const query = statsQuerySchema.safeParse({
        from: c.req.query('from'),
        to: c.req.query('to'),
    })
    if (!query.success) {
        return c.json({ error: 'invalid_query', issues: query.error.issues }, 400)
    }

    const stats = await getStats(createDb(c.env.DB), c.get('userId'), {
        from: query.data.from,
        to: query.data.to,
        now: Math.floor(Date.now() / 1000),
    })
    return c.json(stats)
})

app.get('/api/sessions/:id', async (c) => {
    const result = await getSession(createDb(c.env.DB), c.get('userId'), c.req.param('id'))
    if (result == null) {
        return c.json({ error: 'not_found' }, 404)
    }
    return c.json(result)
})

// Replace a session's laps with an edited set — merges and relabels the user
// made in the session editor. The FIT is never touched; this rewrites the stored
// intervals in place. Returns the session in the same shape as GET, so the client
// can drop the response straight back into the view.
app.put('/api/sessions/:id/intervals', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = replaceLapsSchema.safeParse(body)
    if (!parsed.success) {
        return c.json({ error: 'invalid_payload', issues: parsed.error.issues }, 400)
    }

    const db = createDb(c.env.DB)
    const userId = c.get('userId')
    const id = c.req.param('id')
    const result = await replaceLaps(db, userId, id, parsed.data.groups)
    if (result.status === 'not_found') {
        return c.json({ error: 'not_found' }, 404)
    }
    if (result.status === 'invalid') {
        return c.json({ error: 'invalid_laps', message: result.message }, 400)
    }
    return c.json(await getSession(db, userId, id))
})

app.delete('/api/sessions/:id', async (c) => {
    const deleted = await deleteSession(createDb(c.env.DB), c.get('userId'), c.req.param('id'))
    if (!deleted) {
        return c.json({ error: 'not_found' }, 404)
    }
    // Intervals go with it via ON DELETE CASCADE.
    return c.body(null, 204)
})

// Hard-delete the caller's account and all of their data. The cookie identity
// guarantees they can only ever delete themselves. Their login session goes with
// the account, so a repeat call is stopped by the guard (401) rather than
// reaching here again; `deleteAccount` still answers a missing user harmlessly.
app.delete('/api/account', async (c) => {
    await deleteAccount(createDb(c.env.DB), c.get('userId'))
    return c.body(null, 204)
})

export default app
