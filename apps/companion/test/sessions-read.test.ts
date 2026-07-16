import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { IngestPayload } from '../src/lib/session-payload'
import app from '../worker'

// Rows written by the stub user are the ones the routes should see; anything
// reassigned to this id stands in for another user's data.
const OTHER_USER = 'someone-else'

function payload(id: string, startedAt: number, laps?: IngestPayload['laps']): IngestPayload {
    return {
        id,
        device: { serial: '1234567890', product: 'vivoactive5' },
        session: {
            startedAt,
            endedAt: startedAt + 2313,
            utcOffsetS: 3600,
            totalElapsedS: 2313.637,
            totalTimerS: 2313.637,
            totalCalories: 267,
            avgHr: 99,
            maxHr: 133,
        },
        laps: laps ?? [
            {
                lapIndex: 0,
                station: 'transition',
                startedAt,
                elapsedS: 60,
                timerS: 60,
                avgHr: null,
                maxHr: null,
                calories: null,
                cycles: null,
            },
            {
                lapIndex: 1,
                station: 'Himalayan salt sauna',
                startedAt: startedAt + 60,
                elapsedS: 899.945,
                timerS: 899.945,
                avgHr: 98,
                maxHr: 119,
                calories: 109,
                cycles: 3,
            },
        ],
    }
}

const uuid = (n: number) => `1111111${n}-2222-4333-8444-555555555555`

async function seed(body: IngestPayload) {
    const res = await app.request(
        '/api/sessions',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        },
        env,
    )
    expect(res.status).toBe(201)
}

const countRows = async (table: string) => {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>()
    return row?.n ?? 0
}

describe('GET /api/sessions', () => {
    beforeEach(async () => {
        await env.DB.prepare('DELETE FROM sessions').run()
    })

    it('lists the user’s sessions newest first', async () => {
        await seed(payload(uuid(1), 1783000000))
        await seed(payload(uuid(2), 1783500000))
        await seed(payload(uuid(3), 1783200000))

        const res = await app.request('/api/sessions', {}, env)
        const body = await res.json<{ sessions: { id: string }[] }>()

        expect(res.status).toBe(200)
        expect(body.sessions.map((s) => s.id)).toEqual([uuid(2), uuid(3), uuid(1)])
    })

    it('returns summary rows without the laps', async () => {
        await seed(payload(uuid(1), 1783000000))

        const { sessions } = await (
            await app.request('/api/sessions', {}, env)
        ).json<{
            sessions: Record<string, unknown>[]
        }>()

        expect(sessions[0]).toMatchObject({ id: uuid(1), totalCalories: 267, avgHr: 99 })
        expect(sessions[0]).not.toHaveProperty('intervals')
    })

    it('paginates with limit and offset', async () => {
        await seed(payload(uuid(1), 1783000000))
        await seed(payload(uuid(2), 1783500000))
        await seed(payload(uuid(3), 1783200000))

        const res = await app.request('/api/sessions?limit=1&offset=1', {}, env)
        const body = await res.json<{ sessions: { id: string }[]; limit: number; offset: number }>()

        expect(body.sessions.map((s) => s.id)).toEqual([uuid(3)])
        expect(body).toMatchObject({ limit: 1, offset: 1 })
    })

    it('rejects a limit beyond the cap rather than silently clamping', async () => {
        const res = await app.request('/api/sessions?limit=1000', {}, env)

        expect(res.status).toBe(400)
        expect(await res.json()).toMatchObject({ error: 'invalid_query' })
    })

    it('rejects a non-numeric limit', async () => {
        const res = await app.request('/api/sessions?limit=lots', {}, env)

        expect(res.status).toBe(400)
    })

    it('never lists another user’s sessions', async () => {
        await seed(payload(uuid(1), 1783000000))
        await env.DB.prepare('UPDATE sessions SET user_id = ?').bind(OTHER_USER).run()

        const { sessions } = await (
            await app.request('/api/sessions', {}, env)
        ).json<{
            sessions: unknown[]
        }>()

        expect(sessions).toEqual([])
    })
})

describe('GET /api/sessions/:id', () => {
    beforeEach(async () => {
        await env.DB.prepare('DELETE FROM sessions').run()
    })

    it('returns the session with its intervals in lap order', async () => {
        await seed(payload(uuid(1), 1783000000))

        const res = await app.request(`/api/sessions/${uuid(1)}`, {}, env)
        const body = await res.json<{
            session: { id: string }
            intervals: { lapIndex: number; station: string; thermalClass: string }[]
        }>()

        expect(res.status).toBe(200)
        expect(body.session.id).toBe(uuid(1))
        expect(body.intervals.map((i) => i.lapIndex)).toEqual([0, 1])
        // Station names and classes are resolved, not raw ids.
        expect(body.intervals[1]).toMatchObject({
            station: 'Himalayan salt sauna',
            thermalClass: 'hot',
            isTransition: false,
            avgHr: 98,
        })
    })

    it('404s an unknown id', async () => {
        const res = await app.request(`/api/sessions/${uuid(9)}`, {}, env)

        expect(res.status).toBe(404)
    })

    it('404s another user’s session rather than leaking that it exists', async () => {
        await seed(payload(uuid(1), 1783000000))
        await env.DB.prepare('UPDATE sessions SET user_id = ?').bind(OTHER_USER).run()

        const res = await app.request(`/api/sessions/${uuid(1)}`, {}, env)

        expect(res.status).toBe(404)
    })
})

describe('DELETE /api/sessions/:id', () => {
    beforeEach(async () => {
        await env.DB.prepare('DELETE FROM sessions').run()
    })

    it('deletes the session and cascades to its intervals', async () => {
        await seed(payload(uuid(1), 1783000000))

        const res = await app.request(`/api/sessions/${uuid(1)}`, { method: 'DELETE' }, env)

        expect(res.status).toBe(204)
        expect(await countRows('sessions')).toBe(0)
        expect(await countRows('station_intervals')).toBe(0)
    })

    it('leaves other sessions alone', async () => {
        await seed(payload(uuid(1), 1783000000))
        await seed(payload(uuid(2), 1783500000))

        await app.request(`/api/sessions/${uuid(1)}`, { method: 'DELETE' }, env)

        expect(await countRows('sessions')).toBe(1)
        expect(await countRows('station_intervals')).toBe(2)
    })

    it('404s an unknown id', async () => {
        const res = await app.request(`/api/sessions/${uuid(9)}`, { method: 'DELETE' }, env)

        expect(res.status).toBe(404)
    })

    it('will not delete another user’s session', async () => {
        await seed(payload(uuid(1), 1783000000))
        await env.DB.prepare('UPDATE sessions SET user_id = ?').bind(OTHER_USER).run()

        const res = await app.request(`/api/sessions/${uuid(1)}`, { method: 'DELETE' }, env)

        expect(res.status).toBe(404)
        expect(await countRows('sessions')).toBe(1)
    })
})
