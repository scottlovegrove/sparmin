import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../worker'
import { type SignedIn, signIn } from './auth-helper'
import { countRows, postSession, resetUsers, sessionPayload as payload, uuid } from './helpers'

const SESSION_ID = uuid(1)

// Signed in fresh per test, so these exercise the real guard rather than
// assuming an identity.
let me: SignedIn

const post = (body: unknown) => postSession(me, body)

describe('POST /api/sessions', () => {
    beforeEach(async () => {
        await resetUsers()
        me = await signIn()
    })

    it('creates the session and one interval per lap', async () => {
        const res = await post(payload())

        expect(res.status).toBe(201)
        expect(await res.json()).toEqual({ status: 'created', id: SESSION_ID })
        expect(await countRows('sessions')).toBe(1)
        expect(await countRows('station_intervals')).toBe(2)
    })

    it('stores the session against the current user, verbatim', async () => {
        await post(payload())

        const row = await env.DB.prepare('SELECT * FROM sessions').first<Record<string, unknown>>()
        expect(row).toMatchObject({
            id: SESSION_ID,
            user_id: me.userId,
            started_at: 1783496460,
            ended_at: 1783498774,
            utc_offset_s: 3600,
            device_serial: '1234567890',
            device_product: 'vivoactive5',
            total_calories: 267,
            avg_hr: 99,
            max_hr: 133,
        })
    })

    it('resolves each lap to its station and derives ended_at', async () => {
        await post(payload())

        const rows = await env.DB.prepare(
            `SELECT si.lap_index, si.ended_at, s.name
             FROM station_intervals si JOIN stations s ON s.id = si.station_id
             ORDER BY si.lap_index`,
        ).all<{ lap_index: number; ended_at: number; name: string }>()

        expect(rows.results.map((r) => r.name)).toEqual(['transition', 'Himalayan salt sauna'])
        // ended_at is derived: lap start + elapsed, rounded.
        expect(rows.results[1].ended_at).toBe(Math.round(1783496461 + 899.945))
    })

    it('reports a re-imported file as a duplicate, without writing again', async () => {
        await post(payload())
        // A second export of the same visit gets a fresh client uuid.
        const res = await post(payload({ id: '99999999-2222-4333-8444-555555555555' }))

        expect(res.status).toBe(409)
        expect(await res.json()).toMatchObject({ status: 'duplicate' })
        expect(await countRows('sessions')).toBe(1)
        expect(await countRows('station_intervals')).toBe(2)
    })

    it('treats the same visit recorded on a different watch as one visit', async () => {
        // Deliberate change of behaviour: matching is on start time now, not on
        // the device serial, because a session pushed from the watch has no
        // serial to key on. Two recordings that start together are one visit.
        await post(payload())
        const res = await post(
            payload({
                id: '99999999-2222-4333-8444-555555555555',
                device: { serial: '9999999999', product: 'fr745' },
            }),
        )

        expect(res.status).toBe(409)
        expect(await countRows('sessions')).toBe(1)
    })

    it('folds in a re-import whose start time drifted by a minute', async () => {
        // The two sources round the same instant slightly differently, which is
        // the whole reason matching is a window rather than an exact key.
        await post(payload())
        const res = await post(
            payload({ id: '99999999-2222-4333-8444-555555555555', startedAt: 1783496460 + 60 }),
        )

        expect(res.status).toBe(409)
        expect(await countRows('sessions')).toBe(1)
    })

    it('keeps a second visit that starts outside the match window', async () => {
        await post(payload())
        const res = await post(
            payload({ id: '99999999-2222-4333-8444-555555555555', startedAt: 1783496460 + 301 }),
        )

        expect(res.status).toBe(201)
        expect(await countRows('sessions')).toBe(2)
    })

    it('never matches across users', async () => {
        // The window is a write-side convenience, never a way for one account's
        // timing to reach another's data.
        await post(payload())
        const other = await signIn('other@example.com')
        const res = await postSession(other, payload({ id: uuid(2) }))

        expect(res.status).toBe(201)
        expect(await countRows('sessions')).toBe(2)
    })

    it('auto-inserts an unknown station rather than losing the session', async () => {
        const res = await post(
            payload({
                laps: [
                    {
                        lapIndex: 0,
                        station: 'Cryotherapy chamber', // not in the seeded catalogue
                        startedAt: 1783496460,
                        elapsedS: 120,
                        timerS: 120,
                        avgHr: null,
                        maxHr: null,
                        calories: null,
                        cycles: null,
                    },
                ],
            }),
        )

        expect(res.status).toBe(201)
        const station = await env.DB.prepare(
            "SELECT thermal_class, is_transition FROM stations WHERE name = 'Cryotherapy chamber'",
        ).first<{ thermal_class: string; is_transition: number }>()
        // Surfaces as unclassified for tagging later, never silently dropped.
        expect(station).toMatchObject({ thermal_class: 'unclassified', is_transition: 0 })
    })

    it("folds a renamed station's old lap label onto the row it always meant", async () => {
        // A file recorded before the rename still says "Outdoor lounger".
        const res = await post(
            payload({
                laps: [
                    {
                        lapIndex: 0,
                        station: 'Outdoor lounger',
                        startedAt: 1783496460,
                        elapsedS: 120,
                        timerS: 120,
                        avgHr: null,
                        maxHr: null,
                        calories: null,
                        cycles: null,
                    },
                ],
            }),
        )

        expect(res.status).toBe(201)
        const row = await env.DB.prepare(
            `SELECT s.name, s.slug FROM station_intervals si
             JOIN stations s ON s.id = si.station_id`,
        ).first<{ name: string; slug: string }>()
        expect(row).toMatchObject({ name: 'Loungers', slug: 'outdoor_lounger' })
        // Nothing auto-inserted under the old name.
        const stale = await env.DB.prepare(
            "SELECT COUNT(*) AS n FROM stations WHERE name = 'Outdoor lounger'",
        ).first<{ n: number }>()
        expect(stale?.n).toBe(0)
    })

    it('rejects a payload that fails validation', async () => {
        const res = await post({ ...payload(), id: 'not-a-uuid' })

        expect(res.status).toBe(400)
        expect(await res.json()).toMatchObject({ error: 'invalid_payload' })
        expect(await countRows('sessions')).toBe(0)
    })

    it('rejects a session with no laps', async () => {
        const res = await post(payload({ laps: [] }))

        expect(res.status).toBe(400)
        expect(await countRows('sessions')).toBe(0)
    })

    it('rejects a non-JSON body', async () => {
        const res = await app.request(
            '/api/sessions',
            {
                method: 'POST',
                headers: { ...me.headers, 'Content-Type': 'application/json' },
                body: 'not json',
            },
            env,
        )

        expect(res.status).toBe(400)
    })

    it('deleting a session takes its intervals with it', async () => {
        await post(payload())
        // D1 enforces foreign keys by default, so the cascade needs no PRAGMA.
        await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(SESSION_ID).run()

        expect(await countRows('station_intervals')).toBe(0)
    })
})

// A visit the watch sent live, seeded directly: the watch cannot post one until
// PR4, but the merge path it will use exists now and would otherwise ship
// untested. Its rows are stays only — the watch never records a transition.
describe('a FIT completing a session the watch sent first', () => {
    beforeEach(async () => {
        await resetUsers()
        me = await signIn()
    })

    async function seedWatchSession(minHr: number): Promise<void> {
        const station = await env.DB.prepare(
            `SELECT id FROM stations WHERE name = 'Himalayan salt sauna'`,
        ).first<{ id: number }>()

        await env.DB.batch([
            env.DB.prepare(
                `INSERT INTO sessions
                    (id, user_id, started_at, ended_at, total_elapsed_s, created_at,
                     source, watch_session_id, device_serial, total_calories, avg_hr)
                 VALUES (?, ?, 1783496460, 1783498773, 2313, 1783498800,
                         'watch', 'watch-session-a', NULL, NULL, 95)`,
            ).bind(uuid(7), me.userId),
            env.DB.prepare(
                `INSERT INTO station_intervals
                    (session_id, user_id, station_id, lap_index, started_at, ended_at,
                     elapsed_s, avg_hr, max_hr, min_hr)
                 VALUES (?, ?, ?, 0, 1783496461, 1783497361, 899.945, 98, 119, ?)`,
            ).bind(uuid(7), me.userId, station?.id, minHr),
        ])
    }

    it('merges rather than creating a second session', async () => {
        await seedWatchSession(71)

        const res = await post(payload())

        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ status: 'merged', id: uuid(7) })
        expect(await countRows('sessions')).toBe(1)
    })

    it('fills in what only Garmin measured, and marks the session as both', async () => {
        await seedWatchSession(71)

        await post(payload())

        const row = await env.DB.prepare('SELECT * FROM sessions').first<Record<string, unknown>>()
        expect(row).toMatchObject({
            source: 'both',
            device_serial: '1234567890',
            total_calories: 267,
            // The watch's id survives — the FIT has no way to know it.
            watch_session_id: 'watch-session-a',
            // Garmin's heart rates span the whole visit, the watch's only the stays.
            avg_hr: 99,
        })
    })

    it('takes the FIT laps as the spine, transitions and all', async () => {
        await seedWatchSession(71)

        await post(payload())

        const rows = await env.DB.prepare(
            `SELECT si.lap_index, si.min_hr, si.timer_s, s.name
             FROM station_intervals si JOIN stations s ON s.id = si.station_id
             ORDER BY si.lap_index`,
        ).all<{ lap_index: number; min_hr: number | null; timer_s: number | null; name: string }>()

        // The watch had one row; the FIT's two replace it.
        expect(rows.results.map((r) => r.name)).toEqual(['transition', 'Himalayan salt sauna'])
        // Per-lap timings the watch never had.
        expect(rows.results[1].timer_s).toBe(899.945)
        // And the one thing only the watch knew, on the right lap.
        expect(rows.results[0].min_hr).toBeNull()
        expect(rows.results[1].min_hr).toBe(71)
    })

    it('is a duplicate the second time, not another merge', async () => {
        await seedWatchSession(71)
        await post(payload())

        const res = await post(payload({ id: uuid(3) }))

        expect(res.status).toBe(409)
        expect(await countRows('sessions')).toBe(1)
    })
})
