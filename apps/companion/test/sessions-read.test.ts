import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { IngestPayload } from '../src/lib/session-payload'
import app from '../worker'
import type { SignedIn } from './auth-helper'
import { countRows, resetWithPair, seedSession, sessionPayload, uuid } from './helpers'

// Signed in fresh per test. `other` is a genuine second user — the user_id
// foreign key means a made-up id can't stand in for one any more.
let me: SignedIn
let other: SignedIn

async function reset() {
    ;({ me, other } = await resetWithPair())
}

const payload = (id: string, startedAt: number, laps?: IngestPayload['laps']) =>
    sessionPayload({ id, startedAt, laps })

const seed = (body: IngestPayload) => seedSession(me, body)

describe('GET /api/sessions', () => {
    beforeEach(reset)

    it('lists the user’s sessions newest first', async () => {
        await seed(payload(uuid(1), 1783000000))
        await seed(payload(uuid(2), 1783500000))
        await seed(payload(uuid(3), 1783200000))

        const res = await app.request('/api/sessions', { headers: me.headers }, env)
        const body = await res.json<{ sessions: { id: string }[] }>()

        expect(res.status).toBe(200)
        expect(body.sessions.map((s) => s.id)).toEqual([uuid(2), uuid(3), uuid(1)])
    })

    it('returns summary rows without the laps', async () => {
        await seed(payload(uuid(1), 1783000000))

        const { sessions } = await (
            await app.request('/api/sessions', { headers: me.headers }, env)
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

        const res = await app.request(
            '/api/sessions?limit=1&offset=1',
            { headers: me.headers },
            env,
        )
        const body = await res.json<{ sessions: { id: string }[]; limit: number; offset: number }>()

        expect(body.sessions.map((s) => s.id)).toEqual([uuid(3)])
        expect(body).toMatchObject({ limit: 1, offset: 1 })
    })

    it('rejects a limit beyond the cap rather than silently clamping', async () => {
        const res = await app.request('/api/sessions?limit=1000', { headers: me.headers }, env)

        expect(res.status).toBe(400)
        expect(await res.json()).toMatchObject({ error: 'invalid_query' })
    })

    it('rejects a non-numeric limit', async () => {
        const res = await app.request('/api/sessions?limit=lots', { headers: me.headers }, env)

        expect(res.status).toBe(400)
    })

    it('never lists another user’s sessions', async () => {
        await seed(payload(uuid(1), 1783000000))
        await env.DB.prepare('UPDATE sessions SET user_id = ?').bind(other.userId).run()

        const { sessions } = await (
            await app.request('/api/sessions', { headers: me.headers }, env)
        ).json<{
            sessions: unknown[]
        }>()

        expect(sessions).toEqual([])
    })
})

// 2026-07-08T07:41:02Z, 2026-07-10T07:41:27Z, 2026-08-01T00:00:00Z
const JULY_8 = 1783496462
const JULY_10 = 1783669287
const AUGUST_1 = 1785542400

describe('GET /api/sessions — date range', () => {
    beforeEach(async () => {
        await reset()
        await seed(payload(uuid(1), JULY_8))
        await seed(payload(uuid(2), JULY_10))
        await seed(payload(uuid(3), AUGUST_1))
    })

    const list = async (query: string) => {
        const res = await app.request(`/api/sessions${query}`, { headers: me.headers }, env)
        const body = await res.json<{ sessions: { id: string }[] }>()
        return { status: res.status, ids: body.sessions?.map((s) => s.id) }
    }

    it('bounds the range inclusively at both ends', async () => {
        // A bare date means that whole day, so the 8th's session is in range even
        // though it started at 07:41.
        const { ids } = await list('?from=2026-07-08&to=2026-07-10')

        expect(ids).toEqual([uuid(2), uuid(1)])
    })

    it('excludes days outside the range', async () => {
        const { ids } = await list('?from=2026-07-09&to=2026-07-31')

        expect(ids).toEqual([uuid(2)])
    })

    it('takes `from` on its own', async () => {
        const { ids } = await list('?from=2026-07-09')

        expect(ids).toEqual([uuid(3), uuid(2)])
    })

    it('takes `to` on its own', async () => {
        const { ids } = await list('?to=2026-07-09')

        expect(ids).toEqual([uuid(1)])
    })

    it('accepts a full ISO date-time', async () => {
        const { ids } = await list('?from=2026-07-08T08:00:00Z')

        // Past the 8th's 07:41 start, so that one drops out.
        expect(ids).toEqual([uuid(3), uuid(2)])
    })

    it('rejects a range that runs backwards', async () => {
        const { status } = await list('?from=2026-07-10&to=2026-07-08')

        expect(status).toBe(400)
    })

    it('rejects a date it cannot parse', async () => {
        const { status } = await list('?from=last%20tuesday')

        expect(status).toBe(400)
    })
})

describe('GET /api/sessions?include=intervals', () => {
    beforeEach(reset)

    it('returns each session’s stays, so a period needs no call per session', async () => {
        await seed(payload(uuid(1), JULY_8))
        await seed(payload(uuid(2), JULY_10))

        const res = await app.request(
            '/api/sessions?include=intervals',
            { headers: me.headers },
            env,
        )
        const { sessions } = await res.json<{
            sessions: { id: string; intervals: { order: number; station: string }[] }[]
        }>()

        expect(res.status).toBe(200)
        // Grouped against the right session, in order, not pooled together.
        for (const session of sessions) {
            expect(session.intervals.map((i) => i.order)).toEqual([0, 1])
            expect(session.intervals.map((i) => i.station)).toEqual([
                'transition',
                'Himalayan salt sauna',
            ])
        }
    })

    it('combines with the date range', async () => {
        await seed(payload(uuid(1), JULY_8))
        await seed(payload(uuid(2), AUGUST_1))

        const { sessions } = await (
            await app.request(
                '/api/sessions?from=2026-07-01&to=2026-07-31&include=intervals',
                { headers: me.headers },
                env,
            )
        ).json<{ sessions: { id: string; intervals: unknown[] }[] }>()

        expect(sessions).toHaveLength(1)
        expect(sessions[0].id).toBe(uuid(1))
        expect(sessions[0].intervals).toHaveLength(2)
    })

    it('omits the stays unless asked', async () => {
        await seed(payload(uuid(1), JULY_8))

        const { sessions } = await (
            await app.request('/api/sessions', { headers: me.headers }, env)
        ).json<{ sessions: Record<string, unknown>[] }>()

        expect(sessions[0]).not.toHaveProperty('intervals')
    })

    it('rejects an include it does not know', async () => {
        const res = await app.request(
            '/api/sessions?include=everything',
            { headers: me.headers },
            env,
        )

        expect(res.status).toBe(400)
    })
})

describe('GET /api/sessions/:id', () => {
    beforeEach(reset)

    it('returns the session with its intervals in order', async () => {
        await seed(payload(uuid(1), 1783000000))

        const res = await app.request(`/api/sessions/${uuid(1)}`, { headers: me.headers }, env)
        const body = await res.json<{
            session: { id: string }
            intervals: { order: number; station: string; thermalClass: string }[]
        }>()

        expect(res.status).toBe(200)
        expect(body.session.id).toBe(uuid(1))
        expect(body.intervals.map((i) => i.order)).toEqual([0, 1])
        // Station names and classes are resolved, not raw ids.
        expect(body.intervals[1]).toMatchObject({
            station: 'Himalayan salt sauna',
            thermalClass: 'hot',
            isTransition: false,
            avgHr: 98,
        })
    })

    it('describes the visit, not the FIT recording that produced it', async () => {
        await seed(payload(uuid(1), 1783000000))

        const { intervals } = await (
            await app.request(`/api/sessions/${uuid(1)}`, { headers: me.headers }, env)
        ).json<{ intervals: Record<string, unknown>[] }>()

        expect(intervals[0]).toHaveProperty('order')
        expect(intervals[0]).not.toHaveProperty('lapIndex')
    })

    it('404s an unknown id', async () => {
        const res = await app.request(`/api/sessions/${uuid(9)}`, { headers: me.headers }, env)

        expect(res.status).toBe(404)
    })

    it('404s another user’s session rather than leaking that it exists', async () => {
        await seed(payload(uuid(1), 1783000000))
        await env.DB.prepare('UPDATE sessions SET user_id = ?').bind(other.userId).run()

        const res = await app.request(`/api/sessions/${uuid(1)}`, { headers: me.headers }, env)

        expect(res.status).toBe(404)
    })
})

describe('DELETE /api/sessions/:id', () => {
    beforeEach(reset)

    it('deletes the session and cascades to its intervals', async () => {
        await seed(payload(uuid(1), 1783000000))

        const res = await app.request(
            `/api/sessions/${uuid(1)}`,
            { method: 'DELETE', headers: me.headers },
            env,
        )

        expect(res.status).toBe(204)
        expect(await countRows('sessions')).toBe(0)
        expect(await countRows('station_intervals')).toBe(0)
    })

    it('leaves other sessions alone', async () => {
        await seed(payload(uuid(1), 1783000000))
        await seed(payload(uuid(2), 1783500000))

        await app.request(
            `/api/sessions/${uuid(1)}`,
            { method: 'DELETE', headers: me.headers },
            env,
        )

        expect(await countRows('sessions')).toBe(1)
        expect(await countRows('station_intervals')).toBe(2)
    })

    it('404s an unknown id', async () => {
        const res = await app.request(
            `/api/sessions/${uuid(9)}`,
            { method: 'DELETE', headers: me.headers },
            env,
        )

        expect(res.status).toBe(404)
    })

    it('will not delete another user’s session', async () => {
        await seed(payload(uuid(1), 1783000000))
        await env.DB.prepare('UPDATE sessions SET user_id = ?').bind(other.userId).run()

        const res = await app.request(
            `/api/sessions/${uuid(1)}`,
            { method: 'DELETE', headers: me.headers },
            env,
        )

        expect(res.status).toBe(404)
        expect(await countRows('sessions')).toBe(1)
    })
})
