import { describe, expect, it } from 'vitest'
import { type WatchPayload, countStays } from './watch-payload'

// A payload shaped the way the watch builds one: the stays interleaved with the
// walks between them, and an activity rollup per station visited.
function payload(laps: readonly { activityId: string; minutes: number }[]): WatchPayload {
    let cursor = Date.parse('2026-07-03T15:41:00Z')
    const segments = laps.map((lap) => {
        const startedAt = cursor
        cursor += lap.minutes * 60_000
        return {
            activityId: lap.activityId,
            startedAt: new Date(startedAt).toISOString(),
            endedAt: new Date(cursor).toISOString(),
            hrAvg: null,
            hrMax: null,
            hrMin: null,
        }
    })
    const stations = [...new Set(laps.map((lap) => lap.activityId))].filter(
        (id) => id !== 'transition',
    )

    return {
        sessionId: '77777777-2222-4333-8444-555555555555',
        startedAt: segments[0].startedAt,
        endedAt: segments[segments.length - 1].endedAt,
        totalSeconds: (cursor - Date.parse(segments[0].startedAt)) / 1000,
        transitionSeconds: 0,
        utcOffsetS: 3600,
        installId: 'install-a',
        appVersion: '0.6.0',
        activities: stations.map((activityId) => ({
            activityId,
            displayName: activityId,
            totalSeconds: 900,
            visits: 1,
            hrAvg: null,
            hrMax: null,
            hrMin: null,
        })),
        segments,
    }
}

describe('countStays', () => {
    it('leaves out the walks between stations', () => {
        // Two stations, but five laps: counting laps would announce this visit as
        // more than twice the circuit it was.
        const stays = countStays(
            payload([
                { activityId: 'transition', minutes: 1 },
                { activityId: 'finnish_sauna', minutes: 15 },
                { activityId: 'transition', minutes: 2 },
                { activityId: 'ice_cave', minutes: 3 },
                { activityId: 'transition', minutes: 1 },
            ]),
        )

        expect(stays).toBe(2)
    })

    it('counts a repeat visit again', () => {
        const stays = countStays(
            payload([
                { activityId: 'finnish_sauna', minutes: 15 },
                { activityId: 'transition', minutes: 2 },
                { activityId: 'ice_cave', minutes: 3 },
                { activityId: 'transition', minutes: 2 },
                { activityId: 'finnish_sauna', minutes: 12 },
            ]),
        )

        expect(stays).toBe(3)
    })

    it('counts every lap of a payload from a watch that sends no walks', () => {
        // Older builds send the stays only. Nothing to exclude, so the count is
        // the lap count.
        const stays = countStays(
            payload([
                { activityId: 'finnish_sauna', minutes: 15 },
                { activityId: 'ice_cave', minutes: 3 },
            ]),
        )

        expect(stays).toBe(2)
    })

    it('counts nothing when the visit never reached a station', () => {
        // A session started and ended without entering anything: all walk, no
        // stay, and no activity rollup to name one.
        const stays = countStays(payload([{ activityId: 'transition', minutes: 4 }]))

        expect(stays).toBe(0)
    })
})
