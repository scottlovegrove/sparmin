import { asc } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { stations } from '../src/db/schema'
import { ingestPayloadSchema } from '../src/lib/session-payload'
import { createAuth, currentUserId } from './auth'
import { createDb } from './db'
import {
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    deleteSession,
    getSession,
    ingestSession,
    listSessions,
} from './sessions'

// `Env` is generated from wrangler.jsonc by `npm run cf-typegen`
// (worker-configuration.d.ts) and carries the bindings.
const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>()

// Everything under /api needs a session except these: the auth endpoints
// themselves (you can't be signed in while signing in) and the liveness check,
// which says nothing about anyone's data.
function isPublic(pathname: string) {
    return pathname === '/api/health' || pathname.startsWith('/api/auth/')
}

// Registered before any route, so a route added later is guarded by default
// rather than by remembering to guard it. The session is resolved once here and
// handed to handlers, rather than each one re-reading it.
app.use('/api/*', async (c, next) => {
    if (isPublic(new URL(c.req.url).pathname)) {
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

app.get('/api/health', (c) => c.json({ status: 'ok' }))

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
        return c.json({ status: 'duplicate', id: parsed.data.id }, 409)
    }
    return c.json({ status: 'created', id: parsed.data.id }, 201)
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

app.get('/api/sessions/:id', async (c) => {
    const result = await getSession(createDb(c.env.DB), c.get('userId'), c.req.param('id'))
    if (result == null) {
        return c.json({ error: 'not_found' }, 404)
    }
    return c.json(result)
})

app.delete('/api/sessions/:id', async (c) => {
    const deleted = await deleteSession(createDb(c.env.DB), c.get('userId'), c.req.param('id'))
    if (!deleted) {
        return c.json({ error: 'not_found' }, 404)
    }
    // Intervals go with it via ON DELETE CASCADE.
    return c.body(null, 204)
})

export default app
