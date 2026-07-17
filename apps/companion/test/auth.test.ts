import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../worker'
import { createAuth } from '../worker/auth'
import { TEST_EMAIL, signIn } from './auth-helper'
import { postSession, resetUsers, sessionPayload, uuid } from './helpers'

const SESSION_ID = uuid(1)

// better-auth refuses a state-changing request whose Origin isn't its own — CSRF
// protection. A browser always sends one; app.request doesn't, so tests hitting
// better-auth's own endpoints have to look like a browser.
const browserHeaders = { origin: env.BETTER_AUTH_URL }

describe('the /api guard', () => {
    beforeEach(resetUsers)

    // Every route that touches a user's data, and the methods that reach them.
    const guarded: [string, string][] = [
        ['GET', '/api/sessions'],
        ['POST', '/api/sessions'],
        ['GET', `/api/sessions/${SESSION_ID}`],
        ['DELETE', `/api/sessions/${SESSION_ID}`],
        ['GET', '/api/stations'],
    ]

    it.each(guarded)('refuses %s %s without a session', async (method, path) => {
        const res = await app.request(path, { method }, env)

        expect(res.status).toBe(401)
        expect(await res.json()).toEqual({ error: 'unauthorized' })
    })

    it.each(guarded)('allows %s %s once signed in', async (method, path) => {
        const { headers } = await signIn()

        const res = await app.request(path, { method, headers }, env)

        expect(res.status).not.toBe(401)
    })

    it('ignores a cookie it did not issue', async () => {
        const res = await app.request(
            '/api/sessions',
            { headers: { cookie: 'better-auth.session_token=made-up-token' } },
            env,
        )

        expect(res.status).toBe(401)
    })

    it('leaves the health check open — it reveals nothing', async () => {
        const res = await app.request('/api/health', {}, env)

        expect(res.status).toBe(200)
    })

    it('leaves the auth endpoints open — you cannot sign in while signed in', async () => {
        const res = await app.request(
            '/api/auth/sign-in/magic-link',
            {
                method: 'POST',
                headers: { ...browserHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: TEST_EMAIL, callbackURL: '/' }),
            },
            env,
        )

        expect(res.status).toBe(200)
    })

    it('never has an email key, whatever the developer has in .dev.vars', () => {
        // With one, the suite mails the addresses these tests invent — every run,
        // for real. The config pins it blank; this is what notices if that stops
        // being true.
        expect(env.RESEND_API_KEY).toBeFalsy()
    })

    it('refuses to run at all without a secret, rather than using a guessable one', () => {
        // Handed no secret, better-auth falls back to a default published in its
        // own source, and only rejects it when NODE_ENV is exactly "production" —
        // which a Worker need not set. A deploy that forgets `wrangler secret put`
        // would otherwise serve forgeable sessions.
        expect(() => createAuth({ ...env, BETTER_AUTH_SECRET: '' })).toThrow(
            /BETTER_AUTH_SECRET is not set/,
        )
    })

    it('refuses a cross-site request that carries a session', async () => {
        const { headers } = await signIn()

        // Another site can make a browser send its cookies, but it can't forge the
        // Origin header. better-auth checks it on anything that acts on a session.
        const res = await app.request(
            '/api/auth/sign-out',
            { method: 'POST', headers: { ...headers, origin: 'https://evil.example' } },
            env,
        )

        expect(res.status).toBe(403)
    })
})

describe('magic link sign-in', () => {
    beforeEach(resetUsers)

    it('creates the user on first sign-in and reuses them after', async () => {
        await signIn()
        await signIn()

        const { results } = await env.DB.prepare('SELECT email FROM user').all<{ email: string }>()
        expect(results).toEqual([{ email: TEST_EMAIL }])
    })

    it('scopes data to whoever is signed in', async () => {
        const alice = await signIn('alice@example.com')
        const bob = await signIn('bob@example.com')

        await postSession(alice, sessionPayload({ id: SESSION_ID }))

        // Alice sees her import; Bob sees nothing and can't fetch it by id.
        const hers = await (
            await app.request('/api/sessions', { headers: alice.headers }, env)
        ).json<{
            sessions: unknown[]
        }>()
        const his = await (
            await app.request('/api/sessions', { headers: bob.headers }, env)
        ).json<{
            sessions: unknown[]
        }>()
        const stolen = await app.request(
            `/api/sessions/${SESSION_ID}`,
            { headers: bob.headers },
            env,
        )

        expect(hers.sessions).toHaveLength(1)
        expect(his.sessions).toEqual([])
        expect(stolen.status).toBe(404)
    })

    it('rejects a token that has already been used', async () => {
        let magicUrl = ''
        const auth = createAuth(env, async (_env, link) => {
            magicUrl = link.url
        })
        await auth.api.signInMagicLink({
            body: { email: TEST_EMAIL, callbackURL: '/' },
            headers: new Headers(),
        })
        const token = new URL(magicUrl).searchParams.get('token')

        const first = await app.request(`/api/auth/magic-link/verify?token=${token}`, {}, env)
        const second = await app.request(`/api/auth/magic-link/verify?token=${token}`, {}, env)

        expect(first.headers.get('set-cookie')).not.toBeNull()
        // A link in an inbox is a credential; it must not be reusable.
        expect(second.headers.get('set-cookie')).toBeNull()
    })

    it('signs the user out', async () => {
        const { headers } = await signIn()

        const out = await app.request(
            '/api/auth/sign-out',
            { method: 'POST', headers: { ...headers, ...browserHeaders } },
            env,
        )
        const after = await app.request('/api/sessions', { headers }, env)

        expect(out.status).toBe(200)
        expect(after.status).toBe(401)
    })
})
