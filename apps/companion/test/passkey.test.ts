import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../worker'
import { signIn } from './auth-helper'
import { resetUsers } from './helpers'

// The passkey plugin's own endpoints. A full register/authenticate ceremony needs
// a virtual authenticator (see @simplewebauthn's test helpers) and belongs in a
// browser run, so these tests cover the wiring instead: which endpoints exist,
// which demand a session, and that the relying-party config derives from
// BETTER_AUTH_URL. The ceremony itself is exercised end-to-end by hand.

describe('passkey endpoints', () => {
    beforeEach(resetUsers)

    it('will not list a user’s passkeys without a session', async () => {
        const res = await app.request('/api/auth/passkey/list-user-passkeys', {}, env)

        expect(res.status).toBe(401)
    })

    it('will not start registration without a session', async () => {
        const res = await app.request('/api/auth/passkey/generate-register-options', {}, env)

        expect(res.status).toBe(401)
    })

    it('lists no passkeys for a fresh account', async () => {
        const { headers } = await signIn()

        const res = await app.request('/api/auth/passkey/list-user-passkeys', { headers }, env)

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual([])
    })

    it('offers registration options tied to this site once signed in', async () => {
        const { headers } = await signIn()

        const res = await app.request(
            '/api/auth/passkey/generate-register-options',
            { headers },
            env,
        )
        const options = await res.json<{ rp: { id: string; name: string }; challenge: string }>()

        expect(res.status).toBe(200)
        // rpID/rpName come from BETTER_AUTH_URL (localhost in the test env), not a
        // separate secret — this is what notices if that derivation breaks.
        expect(options.rp).toEqual({ id: 'localhost', name: 'Sparmin' })
        expect(options.challenge).toBeTruthy()
    })

    it('still offers registration options on a session older than a day', async () => {
        const { headers, userId } = await signIn()
        // better-auth normally demands a session "fresh" within the last day before
        // it will register a passkey. Ours last a month, so freshAge is turned off;
        // age the session well past a day and registration must still be offered.
        const longAgo = Date.now() - 40 * 24 * 60 * 60 * 1000
        await env.DB.prepare('UPDATE session SET created_at = ? WHERE user_id = ?')
            .bind(longAgo, userId)
            .run()

        const res = await app.request(
            '/api/auth/passkey/generate-register-options',
            { headers },
            env,
        )

        expect(res.status).toBe(200)
    })

    it('lets a signed-out visitor start a passkey sign-in', async () => {
        // The authenticate step is the way in, so unlike registration it must work
        // before there is any session.
        const res = await app.request('/api/auth/passkey/generate-authenticate-options', {}, env)

        expect(res.status).toBe(200)
    })
})
