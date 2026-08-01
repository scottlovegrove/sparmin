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
import type { Db } from './db'

export type IngestResult =
    | { status: 'created'; id: string }
    // This source has already contributed to the matched session.
    | { status: 'duplicate'; id: string }
    // The other source had it; this one filled in what it was missing.
    | { status: 'merged'; id: string }

// One stay at one station, as it arrives, before its station is resolved to a row.
export type ArrivingInterval = {
    readonly station: string
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

//! Resolve every station label to a stations.id, inserting any label the
//! catalogue doesn't know as `unclassified` rather than rejecting the import
//! (§4.4). A watch that ships a new station must never cost the user a session;
//! the unknown label surfaces for tagging later.
async function resolveStationIds(db: Db, labels: string[]): Promise<Map<string, number>> {
    const unique = [...new Set(labels)]
    const known = await db
        .select({ id: stations.id, name: stations.name })
        .from(stations)
        .where(inArray(stations.name, unique))
    const byName = new Map(known.map((s) => [s.name, s.id]))

    const missing = unique.filter((label) => !byName.has(label))
    if (missing.length === 0) {
        return byName
    }

    const now = Math.floor(Date.now() / 1000)
    const inserted = await db
        .insert(stations)
        .values(
            missing.map((name) => ({
                name,
                thermalClass: 'unclassified' as const,
                createdAt: now,
            })),
        )
        .onConflictDoNothing()
        .returning({ id: stations.id, name: stations.name })
    for (const station of inserted) {
        byName.set(station.name, station.id)
    }

    // A concurrent import may have inserted the same label first, in which case
    // onConflictDoNothing returned nothing for it — read those back.
    const stillMissing = missing.filter((label) => !byName.has(label))
    if (stillMissing.length > 0) {
        const raced = await db
            .select({ id: stations.id, name: stations.name })
            .from(stations)
            .where(inArray(stations.name, stillMissing))
        for (const station of raced) {
            byName.set(station.name, station.id)
        }
    }
    return byName
}

//! Which of these station ids are transitions — the walk between two stays, which
//! the FIT records as a lap of its own and the watch never sends at all.
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
export function fitToArriving(payload: IngestPayload): {
    session: ArrivingSession
    startedAt: number
    endedAt: number
    intervals: ArrivingInterval[]
} {
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
            station: lap.station,
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

    const stationIds = await resolveStationIds(
        db,
        arriving.intervals.map((interval) => interval.station),
    )
    const now = Math.floor(Date.now() / 1000)

    if (match != null) {
        // The watch recorded this visit first. Its rows are its stays; the FIT
        // has a lap for every transition too, and per-lap timings and calories
        // the watch never had — so the FIT becomes the spine and the stored rows
        // are replaced, carrying across the one thing only the watch knew (§3.4).
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
            stationId: stationIds.get(interval.station) as number,
            isTransition: false,
        }))
        const transitions = await transitionStationIds(
            db,
            spine.map((interval) => interval.stationId),
        )
        const aligned = alignWatchSegments(
            spine.map((interval) => ({
                ...interval,
                isTransition: transitions.has(interval.stationId),
            })),
            stored.map((row) => ({ stationId: row.stationId, minHr: row.minHr })),
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
                    stationId: stationIds.get(interval.station) as number,
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

    const sessionRow = db.insert(sessions).values({
        id: payload.id,
        userId,
        startedAt: arriving.startedAt,
        endedAt: arriving.endedAt,
        createdAt: now,
        ...arriving.session,
    })

    const intervalRows = arriving.intervals.map((interval) =>
        db.insert(stationIntervals).values({
            sessionId: payload.id,
            userId,
            // Every label resolved above, inserting any the catalogue lacked.
            stationId: stationIds.get(interval.station) as number,
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

    // One batch, so a half-imported session can never land.
    await db.batch([sessionRow, ...intervalRows])
    return { status: 'created', id: payload.id }
}
