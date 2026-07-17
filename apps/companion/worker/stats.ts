import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import { sessions, stationIntervals, stations } from '../src/db/schema'
import { type Visit, currentStreak, visitsPerWeek } from '../src/lib/streak'
import type { Db } from './db'

export type StationTotal = {
    station: string
    thermalClass: string
    visits: number
    seconds: number
}

export type Stats = {
    from: number
    to: number
    sessions: number
    hotS: number
    coldS: number
    neutralS: number
    perWeek: number
    streakWeeks: number
    stations: StationTotal[]
}

//! Everything the stats view shows, for one user over a range.
//!
//! The sums happen in SQL. Sending every stay to the browser to add up there would
//! be thousands of rows to compute five numbers, and it gets worse every visit.
export async function getStats(
    db: Db,
    userId: string,
    { from, to, now }: { from: number; to: number; now: number },
): Promise<Stats> {
    const inRange = and(
        eq(stationIntervals.userId, userId),
        gte(stationIntervals.startedAt, from),
        lte(stationIntervals.startedAt, to),
    )

    // Time by station. Transitions are excluded: the gap between two stations is
    // real time, but it isn't a visit to anything, and it can't be characterised
    // (see the session view).
    const byStation = await db
        .select({
            station: stations.name,
            thermalClass: stations.thermalClass,
            visits: sql<number>`count(*)`,
            seconds: sql<number>`sum(${stationIntervals.elapsedS})`,
        })
        .from(stationIntervals)
        .innerJoin(stations, eq(stations.id, stationIntervals.stationId))
        .where(and(inRange, eq(stations.isTransition, false)))
        .groupBy(stationIntervals.stationId)

    // The visits themselves, for the count and the pace. One row per visit rather
    // than per stay, so this stays small however long the history gets — and the
    // streak needs the times anyway, not a total.
    const visits: Visit[] = await db
        .select({ startedAt: sessions.startedAt, utcOffsetS: sessions.utcOffsetS })
        .from(sessions)
        .where(
            and(
                eq(sessions.userId, userId),
                gte(sessions.startedAt, from),
                lte(sessions.startedAt, to),
            ),
        )
        .orderBy(asc(sessions.startedAt))

    // A streak is "as of now", not "within the range" — asking about July shouldn't
    // report a streak that ended in July as though it were still running. So it is
    // always measured against every visit, whatever range is on screen.
    //
    // Ordered, and not incidentally: the newest visit's offset is the best guess at
    // where the user is now, which decides the week `now` falls in. Unordered, that
    // would come from whichever row the database returned first.
    const allVisits: Visit[] = await db
        .select({ startedAt: sessions.startedAt, utcOffsetS: sessions.utcOffsetS })
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .orderBy(asc(sessions.startedAt))

    const totals = { hotS: 0, coldS: 0, neutralS: 0 }
    for (const row of byStation) {
        const seconds = Number(row.seconds ?? 0)
        if (row.thermalClass === 'hot') totals.hotS += seconds
        else if (row.thermalClass === 'cold') totals.coldS += seconds
        else if (row.thermalClass === 'neutral') totals.neutralS += seconds
    }

    return {
        from,
        to,
        sessions: visits.length,
        ...totals,
        perWeek: visitsPerWeek(visits.length, from, to),
        streakWeeks: currentStreak(allVisits, now, allVisits.at(-1)?.utcOffsetS ?? null),
        stations: byStation
            .map((row) => ({
                station: row.station,
                thermalClass: row.thermalClass,
                visits: Number(row.visits ?? 0),
                seconds: Number(row.seconds ?? 0),
            }))
            .sort((a, b) => b.seconds - a.seconds),
    }
}
