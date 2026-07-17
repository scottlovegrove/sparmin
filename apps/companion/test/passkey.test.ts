import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../worker'
import { signIn } from './auth-helper'

// The passkey plugin's own endpoints. A full register/authenticate ceremony needs
// a virtual authenticator (see @simplewebauthn's test helpers) and belongs in a
// browser run, so these tests cover the wiring instead: which endpoints exist,
// which demand a session, and that the relying-party config derives from
// BETTER_AUTH_URL. The ceremony itself is exercised end-to-end by hand.

async function clearData() {
    await env.DB.prepare('DELETE FROM sessions').run()
    await env.DB.prepare('DELETE FROM user').run()
}

describe('passkey endpoints', () => {
    beforeEach(clearData)

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

    it('lets a signed-out visitor start a passkey sign-in', async () => {
        // The authenticate step is the way in, so unlike registration it must work
        // before there is any session.
        const res = await app.request('/api/auth/passkey/generate-authenticate-options', {}, env)

        expect(res.status).toBe(200)
    })
})
