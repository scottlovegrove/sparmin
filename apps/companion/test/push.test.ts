import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../worker'
import type { SignedIn } from './auth-helper'
import {
    PUSH_KEYS,
    PUSH_ORIGIN,
    countRows,
    getJson,
    pushSubscription,
    resetWithPair,
    setPushPreferences,
    subscribePush,
} from './helpers'

type Config = {
    publicKey: string | null
    preferences: { sessionUploaded: boolean }
    subscriptions: { id: string; label: string | null; createdAt: number; endpointHash: string }[]
}

let me: SignedIn
let other: SignedIn

beforeEach(async () => {
    ;({ me, other } = await resetWithPair())
})

async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('the guard', () => {
    it('covers the whole /api/push prefix', async () => {
        // Not a formality: these routes were added after the middleware, and the
        // only thing making them private is that the middleware denies by
        // default. A future `PUBLIC_PATHS` edit that got this wrong would expose
        // one account's device list to anyone.
        for (const [path, method] of [
            ['/api/push/config', 'GET'],
            ['/api/push/subscriptions', 'PUT'],
            ['/api/push/subscriptions/anything', 'DELETE'],
            ['/api/push/preferences', 'PATCH'],
        ] as const) {
            const res = await app.request(path, { method }, env)
            expect(res.status, `${method} ${path}`).toBe(401)
        }
    })
})

describe('GET /api/push/config', () => {
    it('offers the VAPID public key to subscribe with', async () => {
        const { status, body } = await getJson<Config>('/api/push/config', me)

        expect(status).toBe(200)
        // Pinned in vitest.config.ts. Null here would mean the UI correctly
        // reports "not available on this deployment" for every test below.
        expect(body.publicKey).toBe(env.VAPID_PUBLIC_KEY)
    })

    it('defaults every notification type to on, with no row written', async () => {
        const { body } = await getJson<Config>('/api/push/config', me)

        expect(body.preferences).toEqual({ sessionUploaded: true })
        expect(body.subscriptions).toEqual([])
        // The default is the absence of a row, not a row full of trues — reading
        // preferences must not write.
        expect(await countRows('notification_prefs')).toBe(0)
    })

    it('identifies a device by the hash of its endpoint, never the endpoint', async () => {
        const endpoint = `${PUSH_ORIGIN}/s/mine`
        await subscribePush(me, pushSubscription({ endpoint }))

        const { body } = await getJson<Config>('/api/push/config', me)

        expect(body.subscriptions).toHaveLength(1)
        expect(body.subscriptions[0].label).toBe('Chrome · MacBook')
        expect(body.subscriptions[0].endpointHash).toBe(await sha256Hex(endpoint))
        // The endpoint is a capability URL: anyone holding it and the keys can
        // push to that device. It must not travel back out.
        expect(JSON.stringify(body)).not.toContain(endpoint)
    })

    it('shows only the caller’s own devices', async () => {
        await subscribePush(me, pushSubscription({ endpoint: `${PUSH_ORIGIN}/s/mine` }))
        await subscribePush(other, pushSubscription({ endpoint: `${PUSH_ORIGIN}/s/theirs` }))

        const { body } = await getJson<Config>('/api/push/config', me)

        expect(body.subscriptions).toHaveLength(1)
        expect(body.subscriptions[0].endpointHash).toBe(await sha256Hex(`${PUSH_ORIGIN}/s/mine`))
    })
})

describe('PUT /api/push/subscriptions', () => {
    it('is idempotent — the client re-sends its endpoint on every load', async () => {
        await subscribePush(me)
        await subscribePush(me)

        expect(await countRows('push_subscriptions')).toBe(1)
    })

    it('updates the keys and label of a subscription the browser rotated', async () => {
        const endpoint = `${PUSH_ORIGIN}/s/rotating`
        await subscribePush(me, pushSubscription({ endpoint, label: 'Old name' }))
        await subscribePush(me, pushSubscription({ endpoint, label: 'New name' }))

        const { body } = await getJson<Config>('/api/push/config', me)
        expect(body.subscriptions).toHaveLength(1)
        expect(body.subscriptions[0].label).toBe('New name')
    })

    it('moves an endpoint to whoever subscribed last', async () => {
        // One browser, two accounts — a shared machine, or someone signing out
        // and back in as somebody else. The endpoint is the browser's, so the row
        // has to follow the account rather than accrue a second one, or the first
        // user keeps receiving the second user's sessions.
        const endpoint = `${PUSH_ORIGIN}/s/shared`
        await subscribePush(me, pushSubscription({ endpoint }))
        await subscribePush(other, pushSubscription({ endpoint }))

        expect(await countRows('push_subscriptions')).toBe(1)
        expect((await getJson<Config>('/api/push/config', me)).body.subscriptions).toEqual([])
        expect((await getJson<Config>('/api/push/config', other)).body.subscriptions).toHaveLength(
            1,
        )
    })

    it('keeps only the most recent devices once an account is over the cap', async () => {
        // A real person has a handful of devices. This is not about them: nothing
        // stops a signed-in client PUTting thousands of distinct endpoints, and
        // every one would then be encrypted and posted to on every watch upload,
        // inside a waitUntil the Worker has to finish.
        for (let i = 0; i < 25; i++) {
            await subscribePush(me, pushSubscription({ endpoint: `${PUSH_ORIGIN}/s/${i}` }))
        }

        expect(await countRows('push_subscriptions')).toBe(20)

        // The device that just subscribed always survives. Note these all land
        // within the same second, so `created_at` alone cannot order them — the
        // row being written is held out of the candidates explicitly. Without
        // that, turning the toggle on can immediately evict the browser that
        // turned it on.
        const { body } = await getJson<Config>('/api/push/config', me)
        const kept = new Set(body.subscriptions.map((row) => row.endpointHash))
        expect(kept.has(await sha256Hex(`${PUSH_ORIGIN}/s/24`))).toBe(true)
    })

    it('does not let one account’s devices evict another’s', async () => {
        await subscribePush(other, pushSubscription({ endpoint: `${PUSH_ORIGIN}/s/theirs` }))
        for (let i = 0; i < 25; i++) {
            await subscribePush(me, pushSubscription({ endpoint: `${PUSH_ORIGIN}/s/${i}` }))
        }

        expect((await getJson<Config>('/api/push/config', other)).body.subscriptions).toHaveLength(
            1,
        )
    })

    it('rejects a body that is not a subscription', async () => {
        for (const body of [
            {},
            { endpoint: 'not-a-url', keys: PUSH_KEYS },
            { endpoint: `${PUSH_ORIGIN}/s/x` },
            { endpoint: `${PUSH_ORIGIN}/s/x`, keys: { p256dh: 'only-one-key' } },
        ]) {
            const res = await app.request(
                '/api/push/subscriptions',
                {
                    method: 'PUT',
                    headers: { ...me.headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                },
                env,
            )
            expect(res.status, JSON.stringify(body)).toBe(400)
        }
        expect(await countRows('push_subscriptions')).toBe(0)
    })
})

describe('DELETE /api/push/subscriptions/:id', () => {
    it('turns off the device it names', async () => {
        await subscribePush(me)
        const { body } = await getJson<Config>('/api/push/config', me)

        const res = await app.request(
            `/api/push/subscriptions/${body.subscriptions[0].id}`,
            { method: 'DELETE', headers: me.headers },
            env,
        )

        expect(res.status).toBe(204)
        expect(await countRows('push_subscriptions')).toBe(0)
    })

    it('will not let one account turn off another’s device', async () => {
        await subscribePush(me)
        const { body } = await getJson<Config>('/api/push/config', me)

        const res = await app.request(
            `/api/push/subscriptions/${body.subscriptions[0].id}`,
            { method: 'DELETE', headers: other.headers },
            env,
        )

        // 404 rather than 403: a wrong guess learns nothing about whether the id
        // exists, matching how the device routes answer.
        expect(res.status).toBe(404)
        expect(await countRows('push_subscriptions')).toBe(1)
    })
})

describe('PATCH /api/push/preferences', () => {
    it('persists a mute', async () => {
        await setPushPreferences(me, { sessionUploaded: false })

        const { body } = await getJson<Config>('/api/push/config', me)
        expect(body.preferences).toEqual({ sessionUploaded: false })
    })

    it('can be turned back on, without a second row', async () => {
        await setPushPreferences(me, { sessionUploaded: false })
        await setPushPreferences(me, { sessionUploaded: true })

        expect((await getJson<Config>('/api/push/config', me)).body.preferences).toEqual({
            sessionUploaded: true,
        })
        expect(await countRows('notification_prefs')).toBe(1)
    })

    it('is per account', async () => {
        await setPushPreferences(me, { sessionUploaded: false })

        expect((await getJson<Config>('/api/push/config', other)).body.preferences).toEqual({
            sessionUploaded: true,
        })
    })

    it('rejects anything that is not a boolean', async () => {
        for (const body of [{}, { sessionUploaded: 'no' }, { sessionUploaded: null }]) {
            const res = await app.request(
                '/api/push/preferences',
                {
                    method: 'PATCH',
                    headers: { ...me.headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                },
                env,
            )
            expect(res.status, JSON.stringify(body)).toBe(400)
        }
    })
})

describe('account deletion', () => {
    it('takes the subscriptions and preferences with it', async () => {
        await subscribePush(me)
        await setPushPreferences(me, { sessionUploaded: false })
        await subscribePush(other, pushSubscription({ endpoint: `${PUSH_ORIGIN}/s/theirs` }))

        const res = await app.request(
            '/api/account',
            { method: 'DELETE', headers: me.headers },
            env,
        )
        expect(res.status).toBe(204)

        // A push endpoint outlives the account that registered it, so a row left
        // behind here would keep a stranger's device on file indefinitely.
        expect(await countRows('push_subscriptions')).toBe(1)
        expect(await countRows('notification_prefs')).toBe(0)
    })
})
