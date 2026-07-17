import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../worker'
import type { SignedIn } from './auth-helper'
import { countRows, resetWithPair, seedSession, sessionPayload as payload, uuid } from './helpers'

// Both users are seeded with the full spread of user-owned rows so the delete
// proves two things at once: everything of the caller's goes, and nothing of the
// other user's is touched.
let me: SignedIn
let other: SignedIn

const del = (who?: SignedIn) =>
    app.request('/api/account', { method: 'DELETE', headers: who?.headers }, env)

// A passkey and a verification token don't come from the plain sign-in flow, so
// seed them directly for the user under test — the passkey to prove the FK
// cascade off `user`, the verification row to prove the explicit by-email purge.
async function countVerification(identifier: string): Promise<number> {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM verification WHERE identifier = ?')
        .bind(identifier)
        .first<{ n: number }>()
    return row?.n ?? 0
}

async function seedPasskeyAndVerification(who: SignedIn, email: string): Promise<void> {
    await env.DB.prepare(
        `INSERT INTO passkey (id, public_key, user_id, credential_id, counter, device_type, backed_up)
         VALUES (?, 'pub', ?, ?, 0, 'singleDevice', 0)`,
    )
        .bind(`pk-${who.userId}`, who.userId, `cred-${who.userId}`)
        .run()
    await env.DB.prepare(
        `INSERT INTO verification (id, identifier, value, expires_at) VALUES (?, ?, 'tok', ?)`,
    )
        .bind(`vf-${who.userId}`, email, Date.now() + 300_000)
        .run()
}

describe('DELETE /api/account', () => {
    beforeEach(async () => {
        ;({ me, other } = await resetWithPair())
        await seedSession(me, payload({ id: uuid(1) }))
        await seedSession(other, payload({ id: uuid(2) }))
        await seedPasskeyAndVerification(me, 'me@example.com')
        await seedPasskeyAndVerification(other, 'other@example.com')
    })

    it('rejects an unauthenticated caller', async () => {
        const res = await del()

        expect(res.status).toBe(401)
        // Nothing was touched.
        expect(await countRows('user')).toBe(2)
        expect(await countRows('sessions')).toBe(2)
    })

    it('hard-deletes the caller and everything cascading off them', async () => {
        const res = await del(me)

        expect(res.status).toBe(204)
        // The account row is gone…
        const users = await env.DB.prepare('SELECT id FROM user').all<{ id: string }>()
        expect(users.results.map((u) => u.id)).toEqual([other.userId])
        // …and everything keyed to it: login sessions, passkeys, spa sessions and
        // their stays. One of each remains — the other user's.
        expect(await countRows('sessions')).toBe(1)
        expect(await countRows('station_intervals')).toBe(2)
        expect(await countRows('session')).toBe(1)
        expect(await countRows('passkey')).toBe(1)
    })

    it("clears the caller's verification tokens, which are keyed by email not id", async () => {
        const otherBefore = await countVerification('other@example.com')

        await del(me)

        // The caller's tokens are gone; the other user's are untouched.
        expect(await countVerification('me@example.com')).toBe(0)
        expect(await countVerification('other@example.com')).toBe(otherBefore)
    })

    it("leaves the other user's data intact", async () => {
        await del(me)

        const sessions = await env.DB.prepare('SELECT user_id FROM sessions').all<{
            user_id: string
        }>()
        expect(sessions.results.map((s) => s.user_id)).toEqual([other.userId])
    })

    it('keeps the seeded station catalogue', async () => {
        const before = await countRows('stations')

        await del(me)

        expect(await countRows('stations')).toBe(before)
        expect(before).toBeGreaterThan(0)
    })

    it('is idempotent once the account is gone', async () => {
        await del(me)
        const again = await del(me)

        // The cookie no longer resolves to a user, so the guard answers first.
        expect(again.status).toBe(401)
    })
})
