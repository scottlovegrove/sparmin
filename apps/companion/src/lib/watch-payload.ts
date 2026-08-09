import { z } from 'zod'

// What the watch posts when you end a session. Deliberately not the FIT payload's
// shape and not worth forcing into it: the two sources agree on almost nothing
// but the start time. This one speaks ISO-8601 rather than unix seconds, sends
// the station's canonical id rather than its display name, carries a per-station
// minimum heart rate the FIT has no field for, and knows nothing of lap indices,
// device serials, calories or timer times.
//
// Mirrors SessionManager.buildPayload() in apps/watch. The `hr`-prefixed names
// are the watch's; the FIT side of this app uses the `Hr`-suffixed ones. See
// docs/watch-sync-spec.md §4.3.

const heartRate = z.number().int().positive().nullable()

export const watchActivitySchema = z.object({
    activityId: z.string().min(1).max(64),
    displayName: z.string().min(1).max(64).nullish(),
    totalSeconds: z.number().nonnegative(),
    visits: z.number().int().positive(),
    hrAvg: heartRate,
    hrMax: heartRate,
    hrMin: heartRate,
})

export const watchSegmentSchema = z
    .object({
        activityId: z.string().min(1).max(64),
        startedAt: z.iso.datetime(),
        endedAt: z.iso.datetime(),
        hrAvg: heartRate,
        hrMax: heartRate,
        hrMin: heartRate,
    })
    // A stay that ends before it starts would be stored with a negative
    // duration and silently poison every total derived from it.
    .refine((segment) => Date.parse(segment.endedAt) >= Date.parse(segment.startedAt), {
        message: '`endedAt` must not be before `startedAt`',
        path: ['endedAt'],
    })

export const watchPayloadSchema = z
    .object({
        // The watch mints this, and it is what makes a re-send from the offline
        // queue idempotent rather than a duplicate.
        sessionId: z.uuid(),
        startedAt: z.iso.datetime(),
        endedAt: z.iso.datetime(),
        totalSeconds: z.number().nonnegative(),
        transitionSeconds: z.number().nonnegative(),
        // Added alongside the watch-side wiring; defaulted so this endpoint can land
        // and be exercised before the watch app ships them.
        utcOffsetS: z.number().int().nullish().default(null),
        installId: z.string().min(1).max(128).nullish().default(null),
        appVersion: z.string().min(1).max(32).nullish().default(null),
        activities: z.array(watchActivitySchema),
        // Every lap in order, the walks between stations included — those carry
        // the station id `transition`, as the FIT lap's label does. Watches on
        // older builds send the stays only, which still ingests and still
        // merges; they just leave the gaps unrecorded.
        segments: z.array(watchSegmentSchema).min(1),
    })
    .refine((payload) => Date.parse(payload.endedAt) >= Date.parse(payload.startedAt), {
        message: '`endedAt` must not be before `startedAt`',
        path: ['endedAt'],
    })

export type WatchActivity = z.infer<typeof watchActivitySchema>
export type WatchSegment = z.infer<typeof watchSegmentSchema>
export type WatchPayload = z.infer<typeof watchPayloadSchema>

//! How many stays at a station the visit holds — a second visit to the same
//! station counts again, because it is another stay.
//!
//! Not `segments.length`: the walks between stations are laps of their own, so
//! that figure roughly doubles the count and makes a visit sound like far more
//! stations than were actually done. The activity rollups are the watch's own list
//! of what counts as a station — they exclude the walks — so a lap is a stay when
//! one of them names it.
export function countStays(payload: WatchPayload): number {
    const stations = new Set(payload.activities.map((activity) => activity.activityId))
    return payload.segments.filter((segment) => stations.has(segment.activityId)).length
}

//! ISO-8601 to unix seconds. The watch formats UTC to the second, so this is
//! exact rather than rounded.
export function toUnixSeconds(iso: string): number {
    return Math.floor(Date.parse(iso) / 1000)
}

//! Session-level heart rates, derived from the segments.
//!
//! The watch does not send them: its own summary is per-station. Leaving them
//! null would mean a session that arrived live shows no heart rate in the list,
//! which is the main view. Averaged by duration so a long stay counts for more
//! than a brief one. The walks between stations drop out of the average on their
//! own: the watch only folds readings into a station's lap, so they arrive with
//! no heart rate to weigh. Garmin's own figures do cover them, so a later FIT
//! import overwrites these — which is exactly what the merge rules already do.
export function deriveSessionHeartRate(segments: readonly WatchSegment[]): {
    avgHr: number | null
    maxHr: number | null
} {
    let weighted = 0
    let seconds = 0
    let maxHr: number | null = null

    for (const segment of segments) {
        const elapsed = toUnixSeconds(segment.endedAt) - toUnixSeconds(segment.startedAt)
        if (segment.hrAvg != null && elapsed > 0) {
            weighted += segment.hrAvg * elapsed
            seconds += elapsed
        }
        if (segment.hrMax != null && (maxHr == null || segment.hrMax > maxHr)) {
            maxHr = segment.hrMax
        }
    }
    return { avgHr: seconds > 0 ? Math.round(weighted / seconds) : null, maxHr }
}
