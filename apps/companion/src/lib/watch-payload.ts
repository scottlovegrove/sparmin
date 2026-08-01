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

export const watchSegmentSchema = z.object({
    activityId: z.string().min(1).max(64),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime(),
    hrAvg: heartRate,
    hrMax: heartRate,
    hrMin: heartRate,
})

export const watchPayloadSchema = z.object({
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
    // Stays only — the watch does not send the walks between them.
    segments: z.array(watchSegmentSchema).min(1),
})

export type WatchActivity = z.infer<typeof watchActivitySchema>
export type WatchSegment = z.infer<typeof watchSegmentSchema>
export type WatchPayload = z.infer<typeof watchPayloadSchema>

//! ISO-8601 to unix seconds. The watch formats UTC to the second, so this is
//! exact rather than rounded.
export function toUnixSeconds(iso: string): number {
    return Math.floor(Date.parse(iso) / 1000)
}

//! Session-level heart rates, derived from the stays.
//!
//! The watch does not send them: its own summary is per-station. Leaving them
//! null would mean a session that arrived live shows no heart rate in the list,
//! which is the main view. Averaged by duration so a long stay counts for more
//! than a brief one. Garmin's own figures span the whole visit including the
//! walks between stations, so a later FIT import overwrites these — which is
//! exactly what the merge rules already do.
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
