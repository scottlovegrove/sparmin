import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/d1'
import { authOptions } from './worker/auth-options'

// Config for `@better-auth/cli generate` only — it needs a static instance to
// read the adapter and plugin list from, whereas the Worker builds its auth per
// request (bindings don't exist at module scope). Keep the plugins here in step
// with worker/auth.ts, or the generated schema won't match what runs.
//
// The D1 handle is never used: schema generation only reads the adapter's
// provider. Nothing here connects to anything.
const schemaOnlyDb = drizzle(null as unknown as D1Database)

export const auth = betterAuth({
    ...authOptions,
    database: drizzleAdapter(schemaOnlyDb, { provider: 'sqlite' }),
    plugins: [magicLink({ sendMagicLink: async () => {} })],
})
