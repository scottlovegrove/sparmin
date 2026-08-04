import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { devices, sessions, stationIntervals, stations } from '../src/db/schema'
import {
    type ArrivingSession,
    SESSION_MATCH_WINDOW_S,
    alignWatchSegments,
    alreadyContributed,
    mergeSession,
} from '../src/lib/session-merge'
import type { IngestPayload } from '../src/lib/session-payload'
import { type WatchPayload, deriveSessionHeartRate, toUnixSeconds } from '../src/lib/watch-payload'
import type { Db } from './db'
import { type StationRef, resolveStations, stationKey } from './station-refs'

export type IngestResult =
    | { status: 'created'; id: string }
    // This source has already contributed to the matched session.
    | { status: 'duplicate'; id: string }
    // The other source had it; this one filled in what it was missing.
    | { status: 'merged'; id: string }

// A whole recording as it arrives, from either source.
export type ArrivingRecording = {
    readonly session: ArrivingSession
    readonly startedAt: number
    readonly endedAt: number
    readonly intervals: ArrivingInterval[]
}

// One stay at one station, as it arrives, before its station is resolved to a row.
export type ArrivingInterval = {
    readonly station: StationRef
    readonly lapIndex: number
    readonly startedAt: number
    readonly elapsedS: number
    readonly timerS: number | null
    readonly avgHr: number | null
    readonly maxHr: number | null
    readonly minHr: number | null
    readonly calories: number | null
    readonly cycles: number | null
}

//! Which of these station ids are transitions — the walk between two stays, which
//! both sources record as a lap of its own.
async function transitionStationIds(db: Db, ids: readonly number[]): Promise<Set<number>> {
    if (ids.length === 0) {
        return new Set()
    }
    const rows = await db
        .select({ id: stations.id, isTransition: stations.isTransition })
        .from(stations)
        .where(inArray(stations.id, [...new Set(ids)]))
    return new Set(rows.filter((row) => row.isTransition).map((row) => row.id))
}

//! The session this one is another recording of, if there is one.
//!
//! Matching is on start time within a window rather than on an exact key,
//! because the two sources round the same instant slightly differently — and
//! because the FIT's device serial, which the old key used, is a column only one
//! source can fill. Closest first, so two candidates resolve deterministically.
async function findMatch(db: Db, userId: string, startedAt: number) {
    const [row] = await db
        .select({
            id: sessions.id,
            source: sessions.source,
            utcOffsetS: sessions.utcOffsetS,
            deviceSerial: sessions.deviceSerial,
            deviceProduct: sessions.deviceProduct,
            totalElapsedS: sessions.totalElapsedS,
            totalTimerS: sessions.totalTimerS,
            totalCalories: sessions.totalCalories,
            avgHr: sessions.avgHr,
            maxHr: sessions.maxHr,
            watchSessionId: sessions.watchSessionId,
            deviceId: sessions.deviceId,
        })
        .from(sessions)
        .where(
            and(
                eq(sessions.userId, userId),
                gte(sessions.startedAt, startedAt - SESSION_MATCH_WINDOW_S),
                lte(sessions.startedAt, startedAt + SESSION_MATCH_WINDOW_S),
            ),
        )
        .orderBy(sql`abs(${sessions.startedAt} - ${startedAt})`)
        .limit(1)
    return row ?? null
}

//! Map a parsed FIT export onto the shape ingest understands. Everything a FIT
//! cannot know — which device on the account sent it, the watch's own id for the
//! session — stays null so a watch push can fill it later (§3.4).
export function fitToArriving(payload: IngestPayload): ArrivingRecording {
    return {
        startedAt: payload.session.startedAt,
        endedAt: payload.session.endedAt,
        session: {
            source: 'fit',
            utcOffsetS: payload.session.utcOffsetS,
            deviceSerial: payload.device.serial,
            deviceProduct: payload.device.product,
            totalElapsedS: payload.session.totalElapsedS,
            totalTimerS: payload.session.totalTimerS,
            totalCalories: payload.session.totalCalories,
            avgHr: payload.session.avgHr,
            maxHr: payload.session.maxHr,
            watchSessionId: null,
            deviceId: null,
        },
        intervals: payload.laps.map((lap) => ({
            station: { kind: 'name' as const, name: lap.station },
            lapIndex: lap.lapIndex,
            startedAt: lap.startedAt,
            elapsedS: lap.elapsedS,
            timerS: lap.timerS,
            avgHr: lap.avgHr,
            maxHr: lap.maxHr,
            // A FIT lap records an average and a maximum, never a minimum.
            minHr: null,
            calories: lap.calories,
            cycles: lap.cycles,
        })),
    }
}

//! Write one recording of a visit, folding it into an existing session if this is
//! the second source to report it.
//!
//! Duplicate imports are a no-op rather than an error — re-dropping a file the
//! user already imported should say "already imported", not fail (§5.2).
export async function ingestSession(
    db: Db,
    userId: string,
    payload: IngestPayload,
): Promise<IngestResult> {
    const arriving = fitToArriving(payload)
    const match = await findMatch(db, userId, arriving.startedAt)

    if (match != null && alreadyContributed(match.source, arriving.session.source)) {
        return { status: 'duplicate', id: match.id }
    }

    const stationIds = await resolveStations(
        db,
        arriving.intervals.map((interval) => interval.station),
    )

    if (match != null) {
        // The watch recorded this visit first. The FIT has per-lap timings and
        // calories the watch never had, and Garmin timed the boundaries — so the
        // FIT becomes the spine and the stored rows are replaced, carrying across
        // the one thing only the watch knew (§3.4).
        const stored = await db
            .select({
                lapIndex: stationIntervals.lapIndex,
                stationId: stationIntervals.stationId,
                minHr: stationIntervals.minHr,
            })
            .from(stationIntervals)
            .where(eq(stationIntervals.sessionId, match.id))
            .orderBy(stationIntervals.lapIndex)

        const spine = arriving.intervals.map((interval) => ({
            lapIndex: interval.lapIndex,
            stationId: stationIds.get(stationKey(interval.station)) as number,
            isTransition: false,
        }))
        const transitions = await transitionStationIds(db, [
            ...spine.map((interval) => interval.stationId),
            ...stored.map((row) => row.stationId),
        ])
        const aligned = alignWatchSegments(
            spine.map((interval) => ({
                ...interval,
                isTransition: transitions.has(interval.stationId),
            })),
            stored.map((row) => ({
                stationId: row.stationId,
                isTransition: transitions.has(row.stationId),
                minHr: row.minHr,
            })),
        )
        // A disagreement means an assumption behind the match already failed.
        // Take the FIT's laps and drop the minimums rather than risk pinning one
        // to the wrong station.
        const minHrByLapIndex =
            aligned.status === 'aligned'
                ? aligned.minHrByLapIndex
                : new Map<number, number | null>()

        // The device that sent this visit has no way to read its own FIT serial
        // number, so this import is the only chance to learn it. Display only —
        // never a key — and only ever filled in once (§4.1).
        const learnSerial =
            match.deviceId != null && arriving.session.deviceSerial != null
                ? [
                      db
                          .update(devices)
                          .set({ serial: arriving.session.deviceSerial })
                          .where(and(eq(devices.id, match.deviceId), isNull(devices.serial))),
                  ]
                : []

        await db.batch([
            db
                .update(sessions)
                .set(mergeSession(match, arriving.session))
                .where(eq(sessions.id, match.id)),
            ...learnSerial,
            db.delete(stationIntervals).where(eq(stationIntervals.sessionId, match.id)),
            ...arriving.intervals.map((interval) =>
                db.insert(stationIntervals).values({
                    sessionId: match.id,
                    userId,
                    stationId: stationIds.get(stationKey(interval.station)) as number,
                    lapIndex: interval.lapIndex,
                    startedAt: interval.startedAt,
                    endedAt: Math.round(interval.startedAt + interval.elapsedS),
                    elapsedS: interval.elapsedS,
                    timerS: interval.timerS,
                    avgHr: interval.avgHr,
                    maxHr: interval.maxHr,
                    minHr: minHrByLapIndex.get(interval.lapIndex) ?? null,
                    calories: interval.calories,
                    cycles: interval.cycles,
                }),
            ),
        ])
        return { status: 'merged', id: match.id }
    }

    return {
        status: 'created',
        id: await insertSession(db, userId, payload.id, arriving, stationIds),
    }
}

//! Insert a session and its stays in one batch, so a half-written visit can
//! never land. Shared by both sources — they differ in what they know, not in
//! how a new session is stored.
async function insertSession(
    db: Db,
    userId: string,
    id: string,
    arriving: ArrivingRecording,
    stationIds: ReadonlyMap<string, number>,
): Promise<string> {
    const sessionRow = db.insert(sessions).values({
        id,
        userId,
        startedAt: arriving.startedAt,
        endedAt: arriving.endedAt,
        createdAt: Math.floor(Date.now() / 1000),
        ...arriving.session,
    })

    const intervalRows = arriving.intervals.map((interval) =>
        db.insert(stationIntervals).values({
            sessionId: id,
            userId,
            // Every station resolved above, inserting any the catalogue lacked.
            stationId: stationIds.get(stationKey(interval.station)) as number,
            lapIndex: interval.lapIndex,
            startedAt: interval.startedAt,
            endedAt: Math.round(interval.startedAt + interval.elapsedS),
            elapsedS: interval.elapsedS,
            timerS: interval.timerS,
            avgHr: interval.avgHr,
            maxHr: interval.maxHr,
            minHr: interval.minHr,
            calories: interval.calories,
            cycles: interval.cycles,
        }),
    )

    await db.batch([sessionRow, ...intervalRows])
    return id
}

//! Map a watch's payload onto the same shape the FIT path uses, so both sources
//! reach one reconciliation.
//!
//! Everything the watch cannot know stays null — the device serial, calories,
//! timer times, per-lap step counts — so a later FIT import fills them rather
//! than finding them already occupied (§3.4). The laps arrive in order and become
//! lap indices; the watch has no lap numbering of its own. The walks between
//! stations come through as laps at the station id `transition`, so a session
//! that only ever arrived live still accounts for the whole visit.
export function watchToArriving(
    payload: WatchPayload,
    device: { id: string; product: string | null },
): ArrivingRecording {
    const displayNames = new Map(
        payload.activities.map((activity) => [activity.activityId, activity.displayName ?? null]),
    )
    const { avgHr, maxHr } = deriveSessionHeartRate(payload.segments)

    return {
        startedAt: toUnixSeconds(payload.startedAt),
        endedAt: toUnixSeconds(payload.endedAt),
        session: {
            source: 'watch',
            utcOffsetS: payload.utcOffsetS ?? null,
            deviceSerial: null,
            // From the linked device rather than the payload, so the list still
            // names the watch. A FIT import overwrites it with Garmin's own.
            deviceProduct: device.product,
            totalElapsedS: payload.totalSeconds,
            totalTimerS: null,
            totalCalories: null,
            avgHr,
            maxHr,
            watchSessionId: payload.sessionId,
            deviceId: device.id,
        },
        intervals: payload.segments.map((segment, index) => {
            const startedAt = toUnixSeconds(segment.startedAt)
            return {
                station: {
                    kind: 'slug' as const,
                    slug: segment.activityId,
                    displayName: displayNames.get(segment.activityId) ?? null,
                },
                lapIndex: index,
                startedAt,
                elapsedS: toUnixSeconds(segment.endedAt) - startedAt,
                timerS: null,
                avgHr: segment.hrAvg,
                maxHr: segment.hrMax,
                minHr: segment.hrMin,
                calories: null,
                cycles: null,
            }
        }),
    }
}

//! Write a session the watch pushed.
//!
//! A re-send is the normal case, not an error: the watch's offline queue retries
//! after any failure, and a response lost on the way back is indistinguishable
//! from one. The watch's own session id is what makes that idempotent (§3.3).
export async function ingestWatchSession(
    db: Db,
    userId: string,
    device: { id: string; product: string | null },
    payload: WatchPayload,
): Promise<IngestResult> {
    const already = await findByWatchSessionId(db, userId, payload.sessionId)
    if (already != null) {
        return { status: 'duplicate', id: already }
    }

    const arriving = watchToArriving(payload, device)
    const match = await findMatch(db, userId, arriving.startedAt)

    if (match != null) {
        if (alreadyContributed(match.source, 'watch')) {
            return { status: 'duplicate', id: match.id }
        }
        // The FIT got here first — its laps are already the spine, and they are
        // the better record of everything except the minimums. Fold those onto
        // the stays they belong to and leave the rows otherwise alone.
        const stored = await db
            .select({
                lapIndex: stationIntervals.lapIndex,
                stationId: stationIntervals.stationId,
                isTransition: stations.isTransition,
            })
            .from(stationIntervals)
            .innerJoin(stations, eq(stations.id, stationIntervals.stationId))
            .where(eq(stationIntervals.sessionId, match.id))
            .orderBy(stationIntervals.lapIndex)

        const stationIds = await resolveStations(
            db,
            arriving.intervals.map((interval) => interval.station),
        )
        const arrivingStationIds = arriving.intervals.map(
            (interval) => stationIds.get(stationKey(interval.station)) as number,
        )
        const transitions = await transitionStationIds(db, arrivingStationIds)
        const aligned = alignWatchSegments(
            stored,
            arriving.intervals.map((interval, index) => ({
                stationId: arrivingStationIds[index],
                isTransition: transitions.has(arrivingStationIds[index]),
                minHr: interval.minHr,
            })),
        )

        // A disagreement means an assumption behind the match already failed —
        // take nothing rather than pin a minimum to the wrong station.
        const minimums = aligned.status === 'aligned' ? [...aligned.minHrByLapIndex] : []
        const intervalWrites = minimums.map(([lapIndex, minHr]) =>
            db
                .update(stationIntervals)
                .set({ minHr })
                .where(
                    and(
                        eq(stationIntervals.sessionId, match.id),
                        eq(stationIntervals.lapIndex, lapIndex),
                    ),
                ),
        )

        await db.batch([
            db
                .update(sessions)
                .set(mergeSession(match, arriving.session))
                .where(eq(sessions.id, match.id)),
            ...intervalWrites,
        ])
        return { status: 'merged', id: match.id }
    }

    const stationIds = await resolveStations(
        db,
        arriving.intervals.map((interval) => interval.station),
    )
    try {
        return {
            status: 'created',
            id: await insertSession(db, userId, crypto.randomUUID(), arriving, stationIds),
        }
    } catch (err) {
        // Two re-sends of the same session can both clear the check above before
        // either insert lands; the unique index on watch_session_id then rejects
        // the loser. That is still a duplicate, not a failure — the watch is
        // retrying, which is what it is supposed to do.
        const raced = await findByWatchSessionId(db, userId, payload.sessionId)
        if (raced != null) {
            return { status: 'duplicate', id: raced }
        }
        throw err
    }
}

//! The session this watch id already wrote, if any. Scoped to the user: the id
//! is the watch's own, so it is only unique in the context of an account.
async function findByWatchSessionId(
    db: Db,
    userId: string,
    watchSessionId: string,
): Promise<string | null> {
    const [row] = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.userId, userId), eq(sessions.watchSessionId, watchSessionId)))
        .limit(1)
    return row?.id ?? null
}
