import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { IngestPayload } from '../src/lib/session-payload'
import app from '../worker'
import { STUB_USER_ID } from '../worker/auth'

const SESSION_ID = '11111111-2222-4333-8444-555555555555'

function payload(overrides: Partial<IngestPayload> = {}): IngestPayload {
    return {
        id: SESSION_ID,
        device: { serial: '1234567890', product: 'vivoactive5' },
        session: {
            startedAt: 1783496460,
            endedAt: 1783498774,
            utcOffsetS: 3600,
            totalElapsedS: 2313.637,
            totalTimerS: 2313.637,
            totalCalories: 267,
            avgHr: 99,
            maxHr: 133,
        },
        laps: [
            {
                lapIndex: 0,
                station: 'transition',
                startedAt: 1783496460,
                elapsedS: 0.092,
                timerS: 0.092,
                avgHr: null,
                maxHr: null,
                calories: null,
                cycles: null,
            },
            {
                lapIndex: 1,
                station: 'Himalayan salt sauna',
                startedAt: 1783496461,
                elapsedS: 899.945,
                timerS: 899.945,
                avgHr: 98,
                maxHr: 119,
                calories: 109,
                cycles: 3,
            },
        ],
        ...overrides,
    }
}

const post = (body: unknown) =>
    app.request(
        '/api/sessions',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        },
        env,
    )

const countRows = async (table: string) => {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>()
    return row?.n ?? 0
}

describe('POST /api/sessions', () => {
    beforeEach(async () => {
        await env.DB.prepare('DELETE FROM sessions').run()
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
            user_id: STUB_USER_ID,
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

    it('accepts the same visit recorded on a different watch', async () => {
        await post(payload())
        const res = await post(
            payload({
                id: '99999999-2222-4333-8444-555555555555',
                device: { serial: '9999999999', product: 'fr745' },
            }),
        )

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
                headers: { 'Content-Type': 'application/json' },
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
