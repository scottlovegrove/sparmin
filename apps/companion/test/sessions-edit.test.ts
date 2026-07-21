import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { IngestPayload, LapGroup } from '../src/lib/session-payload'
import app from '../worker'
import { type SignedIn, signIn } from './auth-helper'
import { countRows, resetUsers, resetWithPair, seedSession, sessionPayload, uuid } from './helpers'

const SESSION_ID = uuid(1)
const START = 1783496460

// A five-lap circuit. Two adjacent Outdoor cold plunges (orders 1 and 3) stand
// in for the double-tap the editor exists to fix.
const CIRCUIT: readonly { station: string; elapsedS: number; avgHr: number | null }[] = [
    { station: 'Finnish sauna', elapsedS: 100, avgHr: 110 },
    { station: 'Outdoor cold plunge', elapsedS: 60, avgHr: 95 },
    { station: 'transition', elapsedS: 5, avgHr: null },
    { station: 'Outdoor cold plunge', elapsedS: 55, avgHr: 90 },
    { station: 'Hydro pool', elapsedS: 140, avgHr: 88 },
]

function circuitLaps(): IngestPayload['laps'] {
    let start = START
    return CIRCUIT.map((stay, i) => {
        const lap = {
            lapIndex: i,
            station: stay.station,
            startedAt: start,
            elapsedS: stay.elapsedS,
            timerS: stay.elapsedS,
            avgHr: stay.avgHr,
            maxHr: stay.avgHr,
            calories: null,
            cycles: null,
        }
        start += stay.elapsedS
        return lap
    })
}

const TOTAL_ELAPSED = CIRCUIT.reduce((sum, stay) => sum + stay.elapsedS, 0)

function circuitPayload(): IngestPayload {
    return sessionPayload({
        laps: circuitLaps(),
        session: { totalElapsedS: TOTAL_ELAPSED, endedAt: START + TOTAL_ELAPSED },
    })
}

async function putGroups(who: SignedIn, id: string, groups: LapGroup[]): Promise<Response> {
    return app.request(
        `/api/sessions/${id}/intervals`,
        {
            method: 'PUT',
            headers: { ...who.headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ groups }),
        },
        env,
    )
}

// The identity edit: one group per lap, each keeping its own label.
function singletons(): LapGroup[] {
    return CIRCUIT.map((stay, i) => ({ station: stay.station, laps: [i] }))
}

type DetailBody = {
    intervals: {
        order: number
        station: string
        isTransition: boolean
        elapsedS: number
        avgHr: number | null
        maxHr: number | null
    }[]
}

let me: SignedIn

describe('PUT /api/sessions/:id/intervals', () => {
    beforeEach(async () => {
        await resetUsers()
        me = await signIn()
        await seedSession(me, circuitPayload())
    })

    it('merges the two cold plunges into one lap and renumbers order', async () => {
        // Fold orders 1–3 (plunge, transition, plunge) into a single plunge.
        const res = await putGroups(me, SESSION_ID, [
            { station: 'Finnish sauna', laps: [0] },
            { station: 'Outdoor cold plunge', laps: [1, 2, 3] },
            { station: 'Hydro pool', laps: [4] },
        ])

        expect(res.status).toBe(200)
        const body = (await res.json()) as DetailBody
        expect(body.intervals.map((i) => i.station)).toEqual([
            'Finnish sauna',
            'Outdoor cold plunge',
            'Hydro pool',
        ])
        expect(body.intervals.map((i) => i.order)).toEqual([0, 1, 2])
        // Spans the first member's start to the last's end: 60 + 5 + 55.
        expect(body.intervals[1].elapsedS).toBe(120)
        expect(await countRows('station_intervals')).toBe(3)
    })

    it('duration-weights the HR of a merged lap', async () => {
        const res = await putGroups(me, SESSION_ID, [
            { station: 'Finnish sauna', laps: [0] },
            { station: 'Outdoor cold plunge', laps: [1, 2, 3] },
            { station: 'Hydro pool', laps: [4] },
        ])

        const body = (await res.json()) as DetailBody
        // (95*60 + 90*55) / (60 + 55) = 92.6 → 93; the transition had no HR to
        // pull it down, and the max is the higher of the two plunges.
        expect(body.intervals[1].avgHr).toBe(93)
        expect(body.intervals[1].maxHr).toBe(95)
    })

    it('relabels a lap as a transition, leaving the rest intact', async () => {
        const groups = singletons()
        groups[1] = { station: 'transition', laps: [1] }

        const res = await putGroups(me, SESSION_ID, groups)

        expect(res.status).toBe(200)
        const body = (await res.json()) as DetailBody
        expect(body.intervals).toHaveLength(5)
        expect(body.intervals[1]).toMatchObject({ station: 'transition', isTransition: true })
        expect(await countRows('station_intervals')).toBe(5)
    })

    it('leaves the session totals untouched — they stay the device truth', async () => {
        await putGroups(me, SESSION_ID, [
            { station: 'Finnish sauna', laps: [0] },
            { station: 'Outdoor cold plunge', laps: [1, 2, 3] },
            { station: 'Hydro pool', laps: [4] },
        ])

        const row = await env.DB.prepare('SELECT total_elapsed_s, ended_at FROM sessions').first<{
            total_elapsed_s: number
            ended_at: number
        }>()
        expect(row).toMatchObject({
            total_elapsed_s: TOTAL_ELAPSED,
            ended_at: START + TOTAL_ELAPSED,
        })
    })

    it('rejects groups that drop a lap', async () => {
        // Orders 1, 2 and 3 are covered by nothing.
        const res = await putGroups(me, SESSION_ID, [
            { station: 'Finnish sauna', laps: [0] },
            { station: 'Hydro pool', laps: [4] },
        ])

        expect(res.status).toBe(400)
        expect(await res.json()).toMatchObject({ error: 'invalid_laps' })
        expect(await countRows('station_intervals')).toBe(5)
    })

    it('rejects groups that reorder the recording', async () => {
        // Every lap is covered once, but 2 and 1 are out of recorded order.
        const res = await putGroups(me, SESSION_ID, [
            { station: 'Finnish sauna', laps: [0] },
            { station: 'Outdoor cold plunge', laps: [2, 1, 3] },
            { station: 'Hydro pool', laps: [4] },
        ])

        expect(res.status).toBe(400)
        expect(await countRows('station_intervals')).toBe(5)
    })

    it('rejects an unknown station rather than growing the catalogue', async () => {
        const stationsBefore = await countRows('stations')
        const groups = singletons()
        groups[1] = { station: 'Cryotherapy chamber', laps: [1] } // not in the catalogue

        const res = await putGroups(me, SESSION_ID, groups)

        expect(res.status).toBe(400)
        expect(await res.json()).toMatchObject({ error: 'invalid_laps' })
        expect(await countRows('stations')).toBe(stationsBefore)
        expect(await countRows('station_intervals')).toBe(5)
    })

    it('rejects an empty grouping', async () => {
        const res = await putGroups(me, SESSION_ID, [])

        expect(res.status).toBe(400)
        expect(await res.json()).toMatchObject({ error: 'invalid_payload' })
        expect(await countRows('station_intervals')).toBe(5)
    })
})

describe('PUT /api/sessions/:id/intervals with imperfect recorded boundaries', () => {
    // A real export's lap boundaries don't tile cleanly: a lap's start can sit a
    // second off the previous lap's rounded end. The edit must not care — it works
    // from the stored rows, not a re-derived timeline. This is the regression that
    // made every save on a real session fail.
    const OVERLAP_LAPS: IngestPayload['laps'] = [
        {
            lapIndex: 0,
            station: 'Finnish sauna',
            startedAt: START,
            elapsedS: 100.7, // ends (rounded) at START+101 …
            timerS: 100.7,
            avgHr: 110,
            maxHr: 130,
            calories: null,
            cycles: null,
        },
        {
            lapIndex: 1,
            station: 'Outdoor cold plunge',
            startedAt: START + 100, // … but the next lap starts at START+100
            elapsedS: 60.4,
            timerS: 60.4,
            avgHr: 95,
            maxHr: 100,
            calories: null,
            cycles: null,
        },
        {
            lapIndex: 2,
            station: 'Hydro pool',
            startedAt: START + 160,
            elapsedS: 140,
            timerS: 140,
            avgHr: 88,
            maxHr: 120,
            calories: null,
            cycles: null,
        },
    ]

    it('accepts an identity edit despite the overlapping boundary', async () => {
        await resetUsers()
        const me = await signIn()
        await seedSession(
            me,
            sessionPayload({
                laps: OVERLAP_LAPS,
                session: { totalElapsedS: 300, endedAt: START + 300 },
            }),
        )

        const res = await putGroups(me, SESSION_ID, [
            { station: 'Finnish sauna', laps: [0] },
            { station: 'Outdoor cold plunge', laps: [1] },
            { station: 'Hydro pool', laps: [2] },
        ])

        expect(res.status).toBe(200)
        expect(await countRows('station_intervals')).toBe(3)
    })
})

describe('PUT /api/sessions/:id/intervals ownership', () => {
    it("won't edit another user's session, and reads as not found", async () => {
        const { me: owner, other } = await resetWithPair()
        await seedSession(owner, circuitPayload())

        const res = await putGroups(other, SESSION_ID, [
            { station: 'Finnish sauna', laps: [0] },
            { station: 'Outdoor cold plunge', laps: [1, 2, 3] },
            { station: 'Hydro pool', laps: [4] },
        ])

        expect(res.status).toBe(404)
        expect(await countRows('station_intervals')).toBe(5)
    })
})
