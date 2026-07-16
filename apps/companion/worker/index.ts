import { asc } from 'drizzle-orm'
import { Hono } from 'hono'
import { stations } from '../src/db/schema'
import { createDb } from './db'

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

export default app
