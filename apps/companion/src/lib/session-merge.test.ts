import { describe, expect, it } from 'vitest'
import {
    type AlignableInterval,
    type ArrivingSession,
    alignWatchSegments,
    alreadyContributed,
    mergeSession,
    type StoredSession,
    type WatchSegment,
} from './session-merge'

// What a FIT import knows: everything Garmin computed, and no idea which device
// on the account sent it.
function fitSession(overrides: Partial<ArrivingSession> = {}): ArrivingSession {
    return {
        source: 'fit',
        utcOffsetS: 3600,
        deviceSerial: '1234567890',
        deviceProduct: 'vivoactive5',
        totalElapsedS: 2313.637,
        totalTimerS: 2313.637,
        totalCalories: 267,
        avgHr: 99,
        maxHr: 133,
        watchSessionId: null,
        deviceId: null,
        ...overrides,
    }
}

// What a watch push knows: no serial, no calories, no timer — but it knows which
// device it is, and it carries the session it minted.
function watchSession(overrides: Partial<ArrivingSession> = {}): ArrivingSession {
    return {
        source: 'watch',
        utcOffsetS: 3600,
        deviceSerial: null,
        deviceProduct: 'vivoactive5',
        totalElapsedS: 2313,
        totalTimerS: null,
        totalCalories: null,
        avgHr: 95,
        maxHr: 130,
        watchSessionId: 'watch-session-a',
        deviceId: 'device-a',
        ...overrides,
    }
}

function stored(from: ArrivingSession): StoredSession {
    return { ...from, source: from.source }
}

describe('alreadyContributed', () => {
    it('is true when the stored session came from this source', () => {
        expect(alreadyContributed('fit', 'fit')).toBe(true)
        expect(alreadyContributed('watch', 'watch')).toBe(true)
    })

    it('is true once both sources have landed, whichever arrives again', () => {
        expect(alreadyContributed('both', 'fit')).toBe(true)
        expect(alreadyContributed('both', 'watch')).toBe(true)
    })

    it('is false when the other source is arriving for the first time', () => {
        expect(alreadyContributed('fit', 'watch')).toBe(false)
        expect(alreadyContributed('watch', 'fit')).toBe(false)
    })
})

describe('mergeSession', () => {
    it('marks the session as carrying both sources', () => {
        const patch = mergeSession(stored(watchSession()), fitSession())

        expect(patch.source).toBe('both')
    })

    it('never rewrites the start time', () => {
        // Moving it would shift the row relative to any window match in flight.
        const patch = mergeSession(stored(watchSession()), fitSession())

        expect(patch).not.toHaveProperty('startedAt')
    })

    describe('a FIT arriving at a watch session', () => {
        it('fills in everything only Garmin measured', () => {
            const patch = mergeSession(stored(watchSession()), fitSession())

            expect(patch).toMatchObject({
                deviceSerial: '1234567890',
                totalCalories: 267,
                totalTimerS: 2313.637,
                utcOffsetS: 3600,
            })
        })

        it('overrides the heart rates the watch derived from its segments', () => {
            // Garmin's are over the whole visit; the watch's only span the stays.
            const patch = mergeSession(stored(watchSession()), fitSession())

            expect(patch).toMatchObject({ avgHr: 99, maxHr: 133 })
        })

        it('keeps the watch id and device, which the FIT cannot know', () => {
            const patch = mergeSession(stored(watchSession()), fitSession())

            expect(patch).toMatchObject({
                watchSessionId: 'watch-session-a',
                deviceId: 'device-a',
            })
        })

        it('does not blank a value the watch supplied and this FIT lacks', () => {
            const patch = mergeSession(
                stored(watchSession({ utcOffsetS: 3600 })),
                fitSession({ utcOffsetS: null }),
            )

            expect(patch.utcOffsetS).toBe(3600)
        })
    })

    describe('a watch push arriving at a FIT session', () => {
        it('leaves everything Garmin measured alone', () => {
            const patch = mergeSession(stored(fitSession()), watchSession())

            expect(patch).toMatchObject({
                deviceSerial: '1234567890',
                deviceProduct: 'vivoactive5',
                totalCalories: 267,
                totalTimerS: 2313.637,
                avgHr: 99,
                maxHr: 133,
                totalElapsedS: 2313.637,
            })
        })

        it('adds the watch id and device the FIT had no way to record', () => {
            const patch = mergeSession(stored(fitSession()), watchSession())

            expect(patch).toMatchObject({
                watchSessionId: 'watch-session-a',
                deviceId: 'device-a',
            })
        })

        it('fills a gap the FIT left rather than leaving it empty', () => {
            const patch = mergeSession(
                stored(fitSession({ totalCalories: null })),
                watchSession({ totalCalories: 200 }),
            )

            expect(patch.totalCalories).toBe(200)
        })

        it('does not blank the serial by arriving without one', () => {
            // The watch has no access to the FIT serial number at all, so its
            // null must never win.
            const patch = mergeSession(stored(fitSession()), watchSession())

            expect(patch.deviceSerial).toBe('1234567890')
        })
    })
})

describe('alignWatchSegments', () => {
    // A FIT lap list as recorded: a transition either side of every stay.
    const spine: AlignableInterval[] = [
        { lapIndex: 0, stationId: 11, isTransition: true },
        { lapIndex: 1, stationId: 5, isTransition: false },
        { lapIndex: 2, stationId: 11, isTransition: true },
        { lapIndex: 3, stationId: 9, isTransition: false },
    ]

    it('pairs the stays when the watch sends its transitions too', () => {
        const segments: WatchSegment[] = [
            { stationId: 11, isTransition: true, minHr: null },
            { stationId: 5, isTransition: false, minHr: 71 },
            { stationId: 11, isTransition: true, minHr: null },
            { stationId: 9, isTransition: false, minHr: 58 },
        ]

        const result = alignWatchSegments(spine, segments)

        expect(result).toEqual({
            status: 'aligned',
            minHrByLapIndex: new Map([
                [1, 71],
                [3, 58],
            ]),
        })
    })

    it('still aligns a payload from a watch that sends stays only', () => {
        // An older build, or a session that has been sat in its offline queue
        // since before one — the walks between stations are simply absent.
        const segments: WatchSegment[] = [
            { stationId: 5, isTransition: false, minHr: 71 },
            { stationId: 9, isTransition: false, minHr: 58 },
        ]

        const result = alignWatchSegments(spine, segments)

        expect(result).toEqual({
            status: 'aligned',
            minHrByLapIndex: new Map([
                [1, 71],
                [3, 58],
            ]),
        })
    })

    it('refuses to align when the stays and segments disagree in number', () => {
        const result = alignWatchSegments(spine, [{ stationId: 5, isTransition: false, minHr: 71 }])

        expect(result.status).toBe('mismatched')
    })

    it('refuses to align when a station does not match', () => {
        // Better no minimum heart rate than one on the wrong station.
        const segments: WatchSegment[] = [
            { stationId: 5, isTransition: false, minHr: 71 },
            { stationId: 4, isTransition: false, minHr: 58 },
        ]

        const result = alignWatchSegments(spine, segments)

        expect(result.status).toBe('mismatched')
    })

    it('carries a missing minimum through rather than dropping the stay', () => {
        const segments: WatchSegment[] = [
            { stationId: 5, isTransition: false, minHr: null },
            { stationId: 9, isTransition: false, minHr: 58 },
        ]

        const result = alignWatchSegments(spine, segments)

        expect(result.status).toBe('aligned')
        expect(result.status === 'aligned' && result.minHrByLapIndex.get(1)).toBeNull()
    })
})
