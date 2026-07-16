import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { sessions, stationIntervals, stations } from '../src/db/schema'
import type { IngestPayload } from '../src/lib/session-payload'
import type { Db } from './db'

export type IngestResult = { status: 'created' } | { status: 'duplicate' }

// Pagination bounds for the session list. The cap stops a client asking for the
// lot: D1 is single-threaded, so one huge read stalls every queued query.
export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

//! Resolve every station label in the payload to a stations.id, inserting any
//! label the catalogue doesn't know as `unclassified` rather than rejecting the
//! import (§4.4). A watch that ships a new station must never cost the user a
//! session; the unknown label surfaces for tagging later.
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

//! Write one parsed session and its laps. Duplicate imports (same watch, same
//! start time, same user) are a no-op, not an error — re-dropping a file the user
//! already imported should say "already imported", not fail (§5.2).
export async function ingestSession(
    db: Db,
    userId: string,
    payload: IngestPayload,
): Promise<IngestResult> {
    const existing = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(
            and(
                eq(sessions.userId, userId),
                eq(sessions.deviceSerial, payload.device.serial),
                eq(sessions.startedAt, payload.session.startedAt),
            ),
        )
        .limit(1)
    if (existing.length > 0) {
        return { status: 'duplicate' }
    }

    const stationIds = await resolveStationIds(
        db,
        payload.laps.map((lap) => lap.station),
    )
    const now = Math.floor(Date.now() / 1000)

    const sessionRow = db.insert(sessions).values({
        id: payload.id,
        userId,
        startedAt: payload.session.startedAt,
        endedAt: payload.session.endedAt,
        utcOffsetS: payload.session.utcOffsetS,
        deviceSerial: payload.device.serial,
        deviceProduct: payload.device.product,
        totalElapsedS: payload.session.totalElapsedS,
        totalTimerS: payload.session.totalTimerS,
        totalCalories: payload.session.totalCalories,
        avgHr: payload.session.avgHr,
        maxHr: payload.session.maxHr,
        createdAt: now,
    })

    const intervalRows = payload.laps.map((lap) =>
        db.insert(stationIntervals).values({
            sessionId: payload.id,
            userId,
            // Every label resolved above, inserting any the catalogue lacked.
            stationId: stationIds.get(lap.station) as number,
            lapIndex: lap.lapIndex,
            startedAt: lap.startedAt,
            endedAt: Math.round(lap.startedAt + lap.elapsedS),
            elapsedS: lap.elapsedS,
            timerS: lap.timerS,
            avgHr: lap.avgHr,
            maxHr: lap.maxHr,
            calories: lap.calories,
            cycles: lap.cycles,
        }),
    )

    // One batch, so a half-imported session can never land.
    await db.batch([sessionRow, ...intervalRows])
    return { status: 'created' }
}

//! One page of the user's sessions, newest first. Summary rows only — the laps
//! are a separate read (getSession), so the list stays cheap however long the
//! history gets.
export async function listSessions(
    db: Db,
    userId: string,
    { limit, offset }: { limit: number; offset: number },
) {
    return db
        .select({
            id: sessions.id,
            startedAt: sessions.startedAt,
            endedAt: sessions.endedAt,
            utcOffsetS: sessions.utcOffsetS,
            totalElapsedS: sessions.totalElapsedS,
            totalCalories: sessions.totalCalories,
            avgHr: sessions.avgHr,
            maxHr: sessions.maxHr,
            deviceProduct: sessions.deviceProduct,
        })
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .orderBy(desc(sessions.startedAt))
        .limit(limit)
        .offset(offset)
}

//! One session with its intervals in lap order, station names resolved. Scoped
//! to the user: another user's session id reads as missing, not forbidden.
export async function getSession(db: Db, userId: string, id: string) {
    const [session] = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
        .limit(1)
    if (session == null) {
        return null
    }

    const intervals = await db
        .select({
            lapIndex: stationIntervals.lapIndex,
            station: stations.name,
            thermalClass: stations.thermalClass,
            isTransition: stations.isTransition,
            startedAt: stationIntervals.startedAt,
            endedAt: stationIntervals.endedAt,
            elapsedS: stationIntervals.elapsedS,
            timerS: stationIntervals.timerS,
            avgHr: stationIntervals.avgHr,
            maxHr: stationIntervals.maxHr,
            calories: stationIntervals.calories,
            cycles: stationIntervals.cycles,
        })
        .from(stationIntervals)
        .innerJoin(stations, eq(stations.id, stationIntervals.stationId))
        .where(eq(stationIntervals.sessionId, id))
        .orderBy(asc(stationIntervals.lapIndex))

    return { session, intervals }
}

//! Delete one of the user's sessions. Returns false if it isn't theirs or isn't
//! there. Intervals go with it via ON DELETE CASCADE.
export async function deleteSession(db: Db, userId: string, id: string): Promise<boolean> {
    const deleted = await db
        .delete(sessions)
        .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
        .returning({ id: sessions.id })
    return deleted.length > 0
}
