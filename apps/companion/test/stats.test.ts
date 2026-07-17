import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { IngestPayload } from '../src/lib/session-payload'
import app from '../worker'
import { type SignedIn, signIn } from './auth-helper'

let me: SignedIn
let other: SignedIn

async function reset() {
    await env.DB.prepare('DELETE FROM sessions').run()
    await env.DB.prepare('DELETE FROM user').run()
    me = await signIn('me@example.com')
    other = await signIn('other@example.com')
}

const uuid = (n: number) => `2222222${n}-2222-4333-8444-555555555555`
const DAY = 86400

type Stay = { station: string; elapsedS: number }

function payload(id: string, startedAt: number, stays: Stay[]): IngestPayload {
    return {
        id,
        device: { serial: '1234567890', product: 'vivoactive5' },
        session: {
            startedAt,
            endedAt: startedAt + 3000,
            utcOffsetS: 0,
            totalElapsedS: 3000,
            totalTimerS: 3000,
            totalCalories: null,
            avgHr: null,
            maxHr: null,
        },
        laps: stays.map((stay, i) => ({
            lapIndex: i,
            station: stay.station,
            startedAt: startedAt + i * 60,
            elapsedS: stay.elapsedS,
            timerS: stay.elapsedS,
            avgHr: null,
            maxHr: null,
            calories: null,
            cycles: null,
        })),
    }
}

async function seed(who: SignedIn, body: IngestPayload) {
    const res = await app.request(
        '/api/sessions',
        {
            method: 'POST',
            headers: { ...who.headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        },
        env,
    )
    expect(res.status).toBe(201)
}

type Stats = {
    sessions: number
    hotS: number
    coldS: number
    neutralS: number
    perWeek: number
    streakWeeks: number
    stations: { station: string; visits: number; seconds: number }[]
}

const stats = async (query: string, who: SignedIn = me) => {
    const res = await app.request(`/api/stats${query}`, { headers: who.headers }, env)
    return { status: res.status, body: (await res.json()) as Stats }
}

// Recent, so "current streak" means something relative to the real clock.
const now = Math.floor(Date.now() / 1000)
const daysAgo = (n: number) => now - n * DAY
const isoOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10)

describe('GET /api/stats', () => {
    beforeEach(reset)

    it('adds up the time by what the station is', async () => {
        await seed(
            me,
            payload(uuid(1), daysAgo(2), [
                { station: 'Himalayan salt sauna', elapsedS: 900 },
                { station: 'transition', elapsedS: 60 },
                { station: 'Outdoor cold plunge', elapsedS: 300 },
                { station: 'Outdoor lounger', elapsedS: 120 },
            ]),
        )

        const { status, body } = await stats(`?from=${isoOf(daysAgo(7))}&to=${isoOf(now)}`)

        expect(status).toBe(200)
        expect(body).toMatchObject({ sessions: 1, hotS: 900, coldS: 300, neutralS: 120 })
    })

    it('leaves the time between stations out of the totals', async () => {
        await seed(
            me,
            payload(uuid(1), daysAgo(2), [
                { station: 'Himalayan salt sauna', elapsedS: 600 },
                { station: 'transition', elapsedS: 240 },
            ]),
        )

        const { body } = await stats(`?from=${isoOf(daysAgo(7))}&to=${isoOf(now)}`)

        // Real time, but not a visit to anything, and not characterisable.
        expect(body.hotS).toBe(600)
        expect(body.stations.map((s) => s.station)).not.toContain('transition')
    })

    it('ranks the stations by where the time actually went', async () => {
        await seed(
            me,
            payload(uuid(1), daysAgo(2), [
                { station: 'Steam room', elapsedS: 300 },
                { station: 'Himalayan salt sauna', elapsedS: 900 },
                { station: 'Steam room', elapsedS: 200 },
            ]),
        )

        const { body } = await stats(`?from=${isoOf(daysAgo(7))}&to=${isoOf(now)}`)

        expect(body.stations).toEqual([
            { station: 'Himalayan salt sauna', thermalClass: 'hot', visits: 1, seconds: 900 },
            // Two visits, folded into one row and summed.
            { station: 'Steam room', thermalClass: 'hot', visits: 2, seconds: 500 },
        ])
    })

    it('counts only what falls inside the range', async () => {
        await seed(me, payload(uuid(1), daysAgo(2), [{ station: 'Steam room', elapsedS: 600 }]))
        await seed(me, payload(uuid(2), daysAgo(60), [{ station: 'Steam room', elapsedS: 900 }]))

        const { body } = await stats(`?from=${isoOf(daysAgo(7))}&to=${isoOf(now)}`)

        expect(body.sessions).toBe(1)
        expect(body.hotS).toBe(600)
    })

    it('reports the streak as of now, not as of the range', async () => {
        // A visit this week, and a range that predates it entirely.
        await seed(me, payload(uuid(1), daysAgo(1), [{ station: 'Steam room', elapsedS: 600 }]))

        const { body } = await stats(`?from=${isoOf(daysAgo(90))}&to=${isoOf(daysAgo(60))}`)

        // Nothing in the range, but the habit is alive — asking about April must
        // not report the streak as broken.
        expect(body.sessions).toBe(0)
        expect(body.streakWeeks).toBe(1)
    })

    it('never counts another user’s visits', async () => {
        await seed(other, payload(uuid(9), daysAgo(2), [{ station: 'Steam room', elapsedS: 900 }]))

        const { body } = await stats(`?from=${isoOf(daysAgo(7))}&to=${isoOf(now)}`)

        expect(body).toMatchObject({ sessions: 0, hotS: 0, streakWeeks: 0 })
        expect(body.stations).toEqual([])
    })

    it('is honest about an empty range rather than erroring', async () => {
        const { status, body } = await stats(`?from=${isoOf(daysAgo(7))}&to=${isoOf(now)}`)

        expect(status).toBe(200)
        expect(body).toMatchObject({ sessions: 0, hotS: 0, coldS: 0, perWeek: 0, streakWeeks: 0 })
    })

    it('insists on a range, because a total means nothing without one', async () => {
        expect((await stats('')).status).toBe(400)
        expect((await stats(`?from=${isoOf(daysAgo(7))}`)).status).toBe(400)
    })

    it('rejects a range that runs backwards', async () => {
        expect((await stats(`?from=${isoOf(now)}&to=${isoOf(daysAgo(7))}`)).status).toBe(400)
    })

    it('needs a session, like everything else that touches your data', async () => {
        const res = await app.request(`/api/stats?from=2026-07-01&to=2026-07-31`, {}, env)

        expect(res.status).toBe(401)
    })
})
