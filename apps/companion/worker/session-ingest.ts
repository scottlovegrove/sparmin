import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { sessions, stationIntervals, stations } from '../src/db/schema'
import {
    type ArrivingSession,
    SESSION_MATCH_WINDOW_S,
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

    if (match != null) {
        if (alreadyContributed(match.source, arriving.session.source)) {
            return { status: 'duplicate', id: match.id }
        }
        // The other source recorded this visit first. Fill in what it lacked;
        // the interval work belongs to whichever source owns the spine, and only
        // the watch path has a second list to reconcile — see §3.4.
        const patch = mergeSession(match, arriving.session)
        await db.update(sessions).set(patch).where(eq(sessions.id, match.id))
        return { status: 'merged', id: match.id }
    }

    const stationIds = await resolveStationIds(
        db,
        arriving.intervals.map((interval) => interval.station),
    )
    const now = Math.floor(Date.now() / 1000)

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
