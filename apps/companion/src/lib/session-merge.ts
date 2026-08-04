import type { SessionSource } from '../db/schema'

// How far apart two recordings of the same visit may start and still be treated
// as one session.
//
// The two sources genuinely agree on start time: the watch takes `now` from
// Time.now() in the same call that starts the FIT recording, which is what Garmin
// stamps as session.start_time. They differ by at most a second or two — fatal to
// an exact key, fine for a window.
//
// Five minutes is drawn from how close two real visits ever start. Across 123
// recorded sessions the tightest gap between consecutive starts was 23.8 minutes,
// and only four pairs fell inside an hour. So this is about a fifth of the
// closest real gap: wide enough to absorb any plausible clock skew, nowhere near
// wide enough to swallow a genuine second visit. See docs/watch-sync-spec.md §3.2.
export const SESSION_MATCH_WINDOW_S = 300

// The fields two sources can disagree about. Everything else on a session row is
// either identity (id, user) or set once at insert.
export type MergeableSession = {
    readonly utcOffsetS: number | null
    readonly deviceSerial: string | null
    readonly deviceProduct: string | null
    readonly totalElapsedS: number
    readonly totalTimerS: number | null
    readonly totalCalories: number | null
    readonly avgHr: number | null
    readonly maxHr: number | null
    readonly watchSessionId: string | null
    readonly deviceId: string | null
}

export type StoredSession = MergeableSession & { readonly source: SessionSource }
export type ArrivingSession = MergeableSession & { readonly source: 'fit' | 'watch' }

// Only what changes. `startedAt` is deliberately absent from the key set rather
// than merely unset: rewriting it would move the row relative to any window match
// still in flight, so the type refuses it (§3.4).
export type SessionPatch = Partial<MergeableSession> & { source: SessionSource }

//! The stored value stands; an arriving one only fills a gap.
function keep<T>(stored: T | null, arriving: T | null): T | null {
    return stored ?? arriving
}

//! The arriving value stands — but absence is not a value, so it never blanks
//! what the other source already supplied.
function take<T>(stored: T | null, arriving: T | null): T | null {
    return arriving ?? stored
}

//! Whether a session already carries data from this source, in which case the
//! arriving copy is a duplicate rather than something to merge.
export function alreadyContributed(stored: SessionSource, arriving: 'fit' | 'watch'): boolean {
    return stored === 'both' || stored === arriving
}

//! Fold an arriving session into a stored one, returning only the columns that
//! change.
//!
//! Which side wins is fixed by what each source can actually know. The FIT
//! measured everything Garmin computed — calories, timer times, the device
//! serial, the UTC offset, the session totals — so it wins those outright. The
//! watch is the only source of a per-station minimum heart rate, and the only one
//! that knows which device sent it. Neither side ever blanks a value the other
//! supplied, whichever direction the merge runs in. See §3.4.
export function mergeSession(stored: StoredSession, arriving: ArrivingSession): SessionPatch {
    const fitIsArriving = arriving.source === 'fit'
    // Garmin's own measurements: the FIT is authoritative wherever it is present.
    const garmin = fitIsArriving ? take : keep
    // What only the watch can say. Same rule, opposite direction.
    const watch = fitIsArriving ? keep : take

    return {
        source: 'both',
        utcOffsetS: garmin(stored.utcOffsetS, arriving.utcOffsetS),
        deviceSerial: garmin(stored.deviceSerial, arriving.deviceSerial),
        deviceProduct: garmin(stored.deviceProduct, arriving.deviceProduct),
        totalTimerS: garmin(stored.totalTimerS, arriving.totalTimerS),
        totalCalories: garmin(stored.totalCalories, arriving.totalCalories),
        avgHr: garmin(stored.avgHr, arriving.avgHr),
        maxHr: garmin(stored.maxHr, arriving.maxHr),
        // The FIT's total spans the whole visit including transitions; so does
        // the watch's. Prefer the FIT's, which Garmin timed.
        totalElapsedS: fitIsArriving ? arriving.totalElapsedS : stored.totalElapsedS,
        watchSessionId: watch(stored.watchSessionId, arriving.watchSessionId),
        deviceId: watch(stored.deviceId, arriving.deviceId),
    }
}

// One stay at one station, from either source, reduced to what alignment needs.
export type AlignableInterval = {
    readonly lapIndex: number
    readonly stationId: number
    readonly isTransition: boolean
}

export type WatchSegment = {
    readonly stationId: number
    readonly isTransition: boolean
    readonly minHr: number | null
}

export type AlignResult =
    | { readonly status: 'aligned'; readonly minHrByLapIndex: ReadonlyMap<number, number | null> }
    | { readonly status: 'mismatched'; readonly reason: string }

//! Attach a watch's segments to a FIT's lap list so the minimum heart rate lands
//! on the right station.
//!
//! Both lists are filtered to their stays before the ordinal zip. The FIT emits a
//! lap for every transition, and so does the watch — but only since 0.7.2, and a
//! watch's offline queue can hold sessions recorded before that. Matching stays
//! to stays is the one pairing that holds either way, and a transition has no
//! minimum heart rate to place regardless: the watch never folds a reading into
//! one.
//!
//! A disagreement aborts rather than guesses. Writing a minimum heart rate onto
//! the wrong station is worse than not writing one at all, and the two lists
//! disagreeing means an assumption behind the match has already failed.
export function alignWatchSegments(
    spine: readonly AlignableInterval[],
    segments: readonly WatchSegment[],
): AlignResult {
    const stays = spine.filter((interval) => !interval.isTransition)
    const sent = segments.filter((segment) => !segment.isTransition)
    if (stays.length !== sent.length) {
        return {
            status: 'mismatched',
            reason: `the FIT has ${stays.length} stays, the watch sent ${sent.length}`,
        }
    }

    const minHrByLapIndex = new Map<number, number | null>()
    for (const [i, stay] of stays.entries()) {
        const segment = sent[i]
        if (stay.stationId !== segment.stationId) {
            return {
                status: 'mismatched',
                reason: `stay ${i + 1} is station ${stay.stationId} in the FIT and ${segment.stationId} on the watch`,
            }
        }
        minHrByLapIndex.set(stay.lapIndex, segment.minHr)
    }
    return { status: 'aligned', minHrByLapIndex }
}
