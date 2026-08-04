import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../worker'
import { type SignedIn, signIn } from './auth-helper'
import {
    countRows,
    linkWatch,
    postSession,
    postWatchSession,
    resetUsers,
    sessionPayload,
    watchPayload,
} from './helpers'

// A session the watch posts as you end it. See docs/watch-sync-spec.md §3.6.

let me: SignedIn
let token: string

// The FIT export of the same visit the default watch payload describes: both
// start at 2026-07-03T15:41:00Z, and the FIT has a transition either side.
const SAME_VISIT_STARTED_AT = 1783093260

describe('a session the watch posts', () => {
    beforeEach(async () => {
        await resetUsers()
        me = await signIn()
        token = (await linkWatch(me)).token
    })

    it('creates the session and one row per lap', async () => {
        const res = await postWatchSession(token, watchPayload())

        expect(res.status).toBe(201)
        expect(await countRows('sessions')).toBe(1)
        // The stay, plus the walk in and the walk out.
        expect(await countRows('station_intervals')).toBe(3)
    })

    it('keeps the walks between stations, so the visit has no holes in it', async () => {
        await postWatchSession(token, watchPayload())

        const rows = await env.DB.prepare(
            `SELECT s.name, s.is_transition, si.elapsed_s FROM station_intervals si
             JOIN stations s ON s.id = si.station_id ORDER BY si.lap_index`,
        ).all<{ name: string; is_transition: number; elapsed_s: number }>()

        expect(rows.results.map((row) => row.name)).toEqual([
            'transition',
            'Himalayan salt sauna',
            'transition',
        ])
        expect(rows.results.map((row) => row.is_transition)).toEqual([1, 0, 1])
        // Consecutive rows, so the session's own total is fully accounted for.
        expect(rows.results.map((row) => row.elapsed_s)).toEqual([1, 900, 1413])
    })

    it('walks land on the seeded transition station rather than a new one', async () => {
        await postWatchSession(token, watchPayload())

        const row = await env.DB.prepare(
            `SELECT id, slug FROM stations WHERE name = 'transition'`,
        ).first<{ id: number; slug: string | null }>()
        // The row a FIT import already uses for the same thing, which claims the
        // watch's id for it the first time a payload names it.
        expect(row?.slug).toBe('transition')
        expect(await countRows('stations')).toBe(12)
    })

    it('records what the watch knows and leaves the rest for the FIT', async () => {
        await postWatchSession(token, watchPayload())

        const row = await env.DB.prepare('SELECT * FROM sessions').first<Record<string, unknown>>()
        expect(row).toMatchObject({
            source: 'watch',
            watch_session_id: '77777777-2222-4333-8444-555555555555',
            utc_offset_s: 3600,
            device_product: 'vivoactive5',
            // Nothing a watch can measure.
            device_serial: null,
            total_calories: null,
            total_timer_s: null,
        })
    })

    it('resolves a station by its canonical id, not its display name', async () => {
        await postWatchSession(token, watchPayload())

        const row = await env.DB.prepare(
            `SELECT s.name, s.slug FROM station_intervals si
             JOIN stations s ON s.id = si.station_id WHERE si.lap_index = 1`,
        ).first<{ name: string; slug: string }>()
        // The seeded row, reached by slug — not a second station named after it.
        expect(row).toMatchObject({ name: 'Himalayan salt sauna', slug: 'salt_sauna' })
        expect(await countRows('stations')).toBe(12)
    })

    it('keeps the minimum heart rate only it can measure', async () => {
        await postWatchSession(token, watchPayload())

        const row = await env.DB.prepare(
            'SELECT min_hr FROM station_intervals WHERE lap_index = 1',
        ).first<{ min_hr: number }>()
        expect(row?.min_hr).toBe(71)
    })

    it('derives a session heart rate so the list is not blank', async () => {
        await postWatchSession(token, watchPayload())

        const row = await env.DB.prepare('SELECT avg_hr, max_hr FROM sessions').first<{
            avg_hr: number
            max_hr: number
        }>()
        expect(row).toMatchObject({ avg_hr: 98, max_hr: 119 })
    })

    it('treats a re-send from the offline queue as success, not a duplicate', async () => {
        await postWatchSession(token, watchPayload())

        // The queue retries after any failure, and a response lost on the way
        // back looks exactly like a failure.
        const res = await postWatchSession(token, watchPayload())

        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ status: 'duplicate' })
        expect(await countRows('sessions')).toBe(1)
    })

    it('reports a re-send as a duplicate even when both land at once', async () => {
        // The offline queue can fire twice before either insert commits; the
        // unique index catches the loser, and it is still a duplicate.
        const [first, second] = await Promise.all([
            postWatchSession(token, watchPayload()),
            postWatchSession(token, watchPayload()),
        ])

        expect([first.status, second.status].sort()).toEqual([200, 201])
        expect(await countRows('sessions')).toBe(1)
    })

    it('notes that the watch is still talking to us', async () => {
        await postWatchSession(token, watchPayload())

        const row = await env.DB.prepare('SELECT last_seen_at FROM devices').first<{
            last_seen_at: number | null
        }>()
        expect(row?.last_seen_at).toEqual(expect.any(Number))
    })

    it('auto-inserts a station the catalogue has never seen', async () => {
        await postWatchSession(
            token,
            watchPayload({
                stays: [
                    {
                        activityId: 'cryo_chamber',
                        displayName: 'Cryotherapy chamber',
                        startedAt: '2026-07-03T15:41:01Z',
                        endedAt: '2026-07-03T15:44:01Z',
                    },
                ],
            }),
        )

        const station = await env.DB.prepare(
            `SELECT slug, thermal_class FROM stations WHERE name = 'Cryotherapy chamber'`,
        ).first<{ slug: string; thermal_class: string }>()
        expect(station).toMatchObject({ slug: 'cryo_chamber', thermal_class: 'unclassified' })
    })

    it('rejects a stay that ends before it starts', async () => {
        // Stored as a negative duration it would silently poison every total
        // derived from it.
        const res = await postWatchSession(
            token,
            watchPayload({
                stays: [
                    {
                        activityId: 'salt_sauna',
                        displayName: 'Himalayan salt sauna',
                        startedAt: '2026-07-03T15:56:01Z',
                        endedAt: '2026-07-03T15:41:01Z',
                    },
                ],
            }),
        )

        expect(res.status).toBe(400)
        expect(await countRows('sessions')).toBe(0)
    })

    it('does not move a slug another station already owns', async () => {
        // `stations` is shared by every account, so a stale payload naming a
        // seeded station under a different id must not repoint it.
        await postWatchSession(
            token,
            watchPayload({
                stays: [
                    {
                        activityId: 'wrong_id_for_salt_sauna',
                        displayName: 'Himalayan salt sauna',
                        startedAt: '2026-07-03T15:41:01Z',
                        endedAt: '2026-07-03T15:56:01Z',
                    },
                ],
            }),
        )

        const row = await env.DB.prepare(
            `SELECT slug FROM stations WHERE name = 'Himalayan salt sauna'`,
        ).first<{ slug: string }>()
        expect(row?.slug).toBe('salt_sauna')
    })

    it('rejects a payload that fails validation', async () => {
        const res = await postWatchSession(token, { ...watchPayload(), sessionId: 'not-a-uuid' })

        expect(res.status).toBe(400)
        expect(await countRows('sessions')).toBe(0)
    })
})

describe('the device token', () => {
    beforeEach(async () => {
        await resetUsers()
        me = await signIn()
        token = (await linkWatch(me)).token
    })

    it('refuses an unknown token', async () => {
        const res = await postWatchSession('not-a-real-token', watchPayload())

        expect(res.status).toBe(401)
        expect(await countRows('sessions')).toBe(0)
    })

    it('refuses a request with no token at all', async () => {
        const res = await app.request(
            '/api/sessions/watch',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(watchPayload()),
            },
            env,
        )

        expect(res.status).toBe(401)
    })

    it('stops working the moment the watch is revoked', async () => {
        const revoked = await linkWatch(me, 'install-b')
        await app.request(
            `/api/devices/${revoked.deviceId}`,
            { method: 'DELETE', headers: me.headers },
            env,
        )

        const res = await postWatchSession(revoked.token, watchPayload())

        expect(res.status).toBe(401)
        expect(await countRows('sessions')).toBe(0)
    })

    it('leaves other watches on the account working', async () => {
        const other = await linkWatch(me, 'install-b')
        await app.request(
            `/api/devices/${other.deviceId}`,
            { method: 'DELETE', headers: me.headers },
            env,
        )

        expect((await postWatchSession(token, watchPayload())).status).toBe(201)
    })

    it('cannot read anything — it is an ingest credential, nothing more', async () => {
        const res = await app.request(
            '/api/sessions',
            { headers: { Authorization: `Bearer ${token}` } },
            env,
        )

        expect(res.status).toBe(401)
    })

    it('is not a substitute for a session on the pairing routes', async () => {
        const res = await app.request(
            '/api/devices',
            { headers: { Authorization: `Bearer ${token}` } },
            env,
        )

        expect(res.status).toBe(401)
    })
})

describe('the same visit arriving from both sources', () => {
    beforeEach(async () => {
        await resetUsers()
        me = await signIn()
        token = (await linkWatch(me)).token
    })

    const fitOfTheSameVisit = () => sessionPayload({ startedAt: SAME_VISIT_STARTED_AT })

    it('merges when the watch got there first', async () => {
        await postWatchSession(token, watchPayload())

        const res = await postSession(me, fitOfTheSameVisit())

        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ status: 'merged' })
        expect(await countRows('sessions')).toBe(1)
    })

    it('merges when the FIT got there first', async () => {
        await postSession(me, fitOfTheSameVisit())

        const res = await postWatchSession(token, watchPayload())

        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ status: 'merged' })
        expect(await countRows('sessions')).toBe(1)
    })

    it('ends up with both sources’ data whichever order they arrive in', async () => {
        await postSession(me, fitOfTheSameVisit())
        await postWatchSession(token, watchPayload())

        const row = await env.DB.prepare('SELECT * FROM sessions').first<Record<string, unknown>>()
        expect(row).toMatchObject({
            source: 'both',
            // Garmin measured these.
            device_serial: '1234567890',
            total_calories: 267,
            // Only the watch knew these.
            watch_session_id: '77777777-2222-4333-8444-555555555555',
        })
        expect(row?.device_id).toEqual(expect.any(String))
    })

    it('puts the watch’s minimum on the FIT’s matching lap', async () => {
        await postSession(me, fitOfTheSameVisit())
        await postWatchSession(token, watchPayload())

        const rows = await env.DB.prepare(
            `SELECT si.lap_index, si.min_hr, s.name FROM station_intervals si
             JOIN stations s ON s.id = si.station_id ORDER BY si.lap_index`,
        ).all<{ lap_index: number; min_hr: number | null; name: string }>()

        // The FIT's spine survives, transitions and all.
        expect(rows.results.map((r) => r.name)).toEqual(['transition', 'Himalayan salt sauna'])
        // The minimum lands on the stay, not the walk to it.
        expect(rows.results[0].min_hr).toBeNull()
        expect(rows.results[1].min_hr).toBe(71)
    })

    it('learns the watch’s serial from the FIT that completes it', async () => {
        await postWatchSession(token, watchPayload())
        await postSession(me, fitOfTheSameVisit())

        const row = await env.DB.prepare('SELECT serial FROM devices').first<{
            serial: string | null
        }>()
        // A watch cannot read its own FIT serial; this import is the only chance.
        expect(row?.serial).toBe('1234567890')
    })
})
