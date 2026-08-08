import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDb } from '../worker/db'
import { notifySessionUploaded, vapidKeys } from '../worker/push'
import type { SignedIn } from './auth-helper'
import { signIn } from './auth-helper'
import {
    PUSH_ORIGIN,
    countRows,
    linkWatch,
    postSession,
    postWatchSession,
    pushSubscription,
    resetUsers,
    sessionPayload,
    setPushPreferences,
    subscribePush,
    watchPayload,
} from './helpers'

// The push itself goes out over `fetch`, and this version of
// @cloudflare/vitest-pool-workers exports no outbound mock — so the global is
// stubbed for the duration of each test. Stubbed in `beforeEach` rather than
// around the act: sign-in and linking happen first and must reach the real
// implementations, so every arrangement is done before the stub goes in.

// The same visit as the watch payload, so a FIT of it merges rather than creating.
const SAME_VISIT_STARTED_AT = 1783093260

type Sent = { url: string; headers: Headers; body: ArrayBuffer }

let me: SignedIn
let token: string
let sent: Sent[]

function stubPushService(status: number): void {
    sent = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input as RequestInfo, init)
        sent.push({
            url: request.url,
            headers: request.headers,
            body: await request.arrayBuffer(),
        })
        return new Response(null, { status })
    })
}

beforeEach(async () => {
    await resetUsers()
    me = await signIn()
    token = (await linkWatch(me)).token
    // Installed for every test, not only the ones that assert on it: an upload
    // that reaches the real network tries to resolve push.example.com and fails
    // inside waitUntil, which surfaces as an unattributed "internal error" long
    // after the test that caused it has passed.
    stubPushService(201)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('a session arriving from the watch', () => {
    it('notifies every device the account has subscribed', async () => {
        await subscribePush(me, pushSubscription({ endpoint: `${PUSH_ORIGIN}/s/phone` }))
        await subscribePush(me, pushSubscription({ endpoint: `${PUSH_ORIGIN}/s/laptop` }))
        stubPushService(201)

        const res = await postWatchSession(token, watchPayload())

        expect(res.status).toBe(201)
        expect(sent.map((push) => push.url).sort()).toEqual([
            `${PUSH_ORIGIN}/s/laptop`,
            `${PUSH_ORIGIN}/s/phone`,
        ])
    })

    it('sends an encrypted aes128gcm body under a VAPID token', async () => {
        await subscribePush(me)
        stubPushService(201)

        await postWatchSession(token, watchPayload())

        expect(sent).toHaveLength(1)
        const [push] = sent
        // aesgcm, the coding the available libraries emit, is rejected by Apple —
        // which is the whole reason worker/web-push.ts exists. Pin it.
        expect(push.headers.get('content-encoding')).toBe('aes128gcm')
        expect(push.headers.get('authorization')).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+,k=/)
        expect(push.headers.get('ttl')).toBeTruthy()
        // 16-byte salt, 4-byte record size, 1-byte key length, 65-byte key, then
        // the record — so anything at or below the header size is not a payload.
        expect(push.body.byteLength).toBeGreaterThan(86)
    })

    it('says nothing when the account has no subscriptions', async () => {
        stubPushService(201)

        await postWatchSession(token, watchPayload())

        expect(sent).toEqual([])
    })
})

describe('what is worth interrupting someone for', () => {
    it('stays silent when the type is muted', async () => {
        await subscribePush(me)
        await setPushPreferences(me, { sessionUploaded: false })
        stubPushService(201)

        const res = await postWatchSession(token, watchPayload())

        expect(res.status).toBe(201)
        expect(sent).toEqual([])
    })

    it('stays silent on a re-send from the watch’s offline queue', async () => {
        await subscribePush(me)
        await postWatchSession(token, watchPayload())
        expect(sent).toHaveLength(1) // the genuine first delivery
        sent = []

        // The queue re-posts after any failure, including a response lost on the
        // way back. Notifying again would buzz for a session already delivered.
        const res = await postWatchSession(token, watchPayload())

        expect(await res.json()).toMatchObject({ status: 'duplicate' })
        expect(sent).toEqual([])
    })

    it('stays silent when the visit was already here from a FIT import', async () => {
        await subscribePush(me)
        await postSession(me, sessionPayload({ startedAt: SAME_VISIT_STARTED_AT }))
        stubPushService(201)

        const res = await postWatchSession(token, watchPayload())

        expect(await res.json()).toMatchObject({ status: 'merged' })
        // The user imported it themselves minutes ago — they know.
        expect(sent).toEqual([])
    })
})

describe('when the push service answers', () => {
    it('drops a subscription it says is gone', async () => {
        await subscribePush(me)
        stubPushService(410)

        await postWatchSession(token, watchPayload())

        // 410 is the browser having dropped the subscription for good. Keeping
        // the row would mean pushing to it on every session, for ever.
        expect(await countRows('push_subscriptions')).toBe(0)
    })

    it('drops one it never had', async () => {
        await subscribePush(me)
        stubPushService(404)

        await postWatchSession(token, watchPayload())

        expect(await countRows('push_subscriptions')).toBe(0)
    })

    it('keeps a subscription through a server error', async () => {
        await subscribePush(me)
        stubPushService(500)

        const res = await postWatchSession(token, watchPayload())

        // A 500 is the push service having a bad day, not a dead device.
        // Dropping the row would silently stop notifications for good.
        expect(await countRows('push_subscriptions')).toBe(1)
        // And the watch must not learn about any of this: it re-queues the whole
        // payload on anything that is not a 2xx, so a push failure turning into a
        // non-201 would make it re-send a session already stored.
        expect(res.status).toBe(201)
    })

    it('keeps a subscription when the request throws outright', async () => {
        await subscribePush(me)
        sent = []
        vi.stubGlobal('fetch', async () => {
            throw new Error('network unreachable')
        })

        const res = await postWatchSession(token, watchPayload())

        expect(res.status).toBe(201)
        expect(await countRows('push_subscriptions')).toBe(1)
    })
})

describe('a deployment with no VAPID keys', () => {
    // Driven through notifySessionUploaded directly rather than through the
    // route. `vi.stubEnv` would be the obvious way to blank a key and post a
    // session, and it would be wrong: it stubs process.env, while the Worker
    // reads the miniflare binding — so the push would still go out and the test
    // would pass having proved nothing.

    it('has no identity to sign with, so there is nothing to send', () => {
        expect(vapidKeys(env)).not.toBeNull()

        for (const missing of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const) {
            expect(vapidKeys({ ...env, [missing]: '' }), missing).toBeNull()
        }
    })

    it('stays quiet rather than throwing behind the response', async () => {
        await subscribePush(me)
        stubPushService(201)

        // Unconfigured push has to be a working app without notifications, not a
        // rejected promise inside waitUntil on every single upload.
        await notifySessionUploaded(
            { ...env, VAPID_PRIVATE_KEY: '' },
            createDb(env.DB),
            me.userId,
            { id: 'abc', totalSeconds: 2314, stayCount: 4 },
            1_800_000_000,
        )

        expect(sent).toEqual([])
    })
})

// A guard on the environment itself: without a real pair pinned in
// vitest.config.ts every test above would take the not-configured branch, assert
// nothing, and still pass.
describe('the test environment', () => {
    it('has a usable VAPID pair', () => {
        expect(env.VAPID_PUBLIC_KEY).toBeTruthy()
        expect(env.VAPID_PRIVATE_KEY).toBeTruthy()
        expect(env.VAPID_SUBJECT).toMatch(/^mailto:/)
    })
})
