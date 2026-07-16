import { asc } from 'drizzle-orm'
import { Hono } from 'hono'
import { stations } from '../src/db/schema'
import { ingestPayloadSchema } from '../src/lib/session-payload'
import { currentUserId } from './auth'
import { createDb } from './db'
import { ingestSession } from './sessions'

// `Env` is generated from wrangler.jsonc by `npm run cf-typegen`
// (worker-configuration.d.ts) and carries the bindings.
const app = new Hono<{ Bindings: Env }>()

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

export default app
