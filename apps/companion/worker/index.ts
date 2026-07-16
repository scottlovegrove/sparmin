import { Hono } from 'hono'

// `Env` is generated from wrangler.jsonc by `npm run cf-typegen`
// (worker-configuration.d.ts) and carries the bindings.
const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

export default app
