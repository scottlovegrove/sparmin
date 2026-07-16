import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { account, session, user, verification } from '../src/db/auth-schema'
import { authOptions } from './auth-options'
import { createDb } from './db'
import { sendMagicLinkEmail } from './email'

export type SendLink = (env: Env, link: { email: string; url: string }) => Promise<void>

// Bindings only exist inside a request on Workers, so the auth instance is built
// per request rather than at module scope. It is a plain object over the D1
// binding — there is no connection to pool or reuse.
//
// `sendLink` is injectable so tests can capture the link rather than send it, and
// still drive the real sign-in flow.
export function createAuth(env: Env, sendLink: SendLink = sendMagicLinkEmail) {
    // Fail closed. Handed no secret, better-auth falls back to a default that is
    // published in its own source — sessions would be signed with a value anyone
    // can read, so anyone could forge one. It only refuses that itself when
    // NODE_ENV is exactly "production", which is Node's variable and nothing a
    // Worker is obliged to set. The secret arrives out of band via
    // `wrangler secret put`, so a deploy that forgets it must break loudly here
    // rather than come up with forgeable sessions.
    if (!env.BETTER_AUTH_SECRET) {
        throw new Error('BETTER_AUTH_SECRET is not set — refusing to run with a guessable secret')
    }

    const db = createDb(env.DB)
    return betterAuth({
        ...authOptions,
        database: drizzleAdapter(db, {
            provider: 'sqlite',
            // better-auth's tables are singular (`user`, `session`); ours are not.
            // Passing them explicitly keeps it off our `sessions` table, which is
            // a spa visit, not a login.
            schema: { user, session, account, verification },
        }),
        baseURL: env.BETTER_AUTH_URL,
        secret: env.BETTER_AUTH_SECRET,
        plugins: [
            magicLink({
                // 5 minutes is better-auth's default and about right: long enough
                // to switch to a mail app, short enough that a leaked link is stale.
                expiresIn: 300,
                sendMagicLink: ({ email, url }) => sendLink(env, { email, url }),
            }),
        ],
    })
}

export type Auth = ReturnType<typeof createAuth>

//! The signed-in user's id, or null. Identity comes from the session cookie via
//! better-auth — never from anything the caller can set. Takes the headers rather
//! than a request context so it stays independent of the router.
export async function currentUserId(env: Env, headers: Headers): Promise<string | null> {
    const session = await createAuth(env).api.getSession({ headers })
    return session?.user.id ?? null
}
