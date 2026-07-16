import { and, eq, inArray } from 'drizzle-orm'
import { sessions, stationIntervals, stations } from '../src/db/schema'
import type { IngestPayload } from '../src/lib/session-payload'
import type { Db } from './db'

export type IngestResult = { status: 'created' } | { status: 'duplicate' }

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
