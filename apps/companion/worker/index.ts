import { asc } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { stations } from '../src/db/schema'
import { ingestPayloadSchema } from '../src/lib/session-payload'
import { currentUserId } from './auth'
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
const app = new Hono<{ Bindings: Env }>()

// Query params arrive as strings or not at all; coerce and bound them here so the
// handlers get real numbers. An out-of-range limit is a 400 rather than a silent
// clamp — better to tell the caller than to quietly return a different page.
const paginationSchema = z.object({
    limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    offset: z.coerce.number().int().nonnegative().default(0),
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

    const result = await ingestSession(createDb(c.env.DB), currentUserId(c), parsed.data)
    if (result.status === 'duplicate') {
        // Not a failure: the user re-dropped a file they already imported.
        return c.json({ status: 'duplicate', id: parsed.data.id }, 409)
    }
    return c.json({ status: 'created', id: parsed.data.id }, 201)
})

// The user's sessions, newest first. Summary rows only — laps come from
// GET /api/sessions/:id, so the list cost doesn't grow with the history.
app.get('/api/sessions', async (c) => {
    const query = paginationSchema.safeParse({
        limit: c.req.query('limit'),
        offset: c.req.query('offset'),
    })
    if (!query.success) {
        return c.json({ error: 'invalid_query', issues: query.error.issues }, 400)
    }

    const { limit, offset } = query.data
    const rows = await listSessions(createDb(c.env.DB), currentUserId(c), { limit, offset })
    return c.json({ sessions: rows, limit, offset })
})

app.get('/api/sessions/:id', async (c) => {
    const result = await getSession(createDb(c.env.DB), currentUserId(c), c.req.param('id'))
    if (result == null) {
        return c.json({ error: 'not_found' }, 404)
    }
    return c.json(result)
})

app.delete('/api/sessions/:id', async (c) => {
    const deleted = await deleteSession(createDb(c.env.DB), currentUserId(c), c.req.param('id'))
    if (!deleted) {
        return c.json({ error: 'not_found' }, 404)
    }
    // Intervals go with it via ON DELETE CASCADE.
    return c.body(null, 204)
})

export default app
