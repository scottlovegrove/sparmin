import { desc, sql } from 'drizzle-orm'
import { check, index, integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { user } from './auth-schema'

// D1 (SQLite) schema. See docs/spa-logger-spec.md §3.
// The `user` table is better-auth's, defined in auth-schema.ts from its CLI —
// note it is singular, and unrelated to the `sessions` table below, which is a
// spa visit rather than a login.

export const THERMAL_CLASSES = ['hot', 'cold', 'neutral', 'unclassified'] as const
export type ThermalClass = (typeof THERMAL_CLASSES)[number]

// The closed set of station labels the watch writes to each FIT lap. Names are
// the raw developer-field values (SpaActivity.NAMES plus the transition label),
// so they must match the watch app's strings exactly.
export const stations = sqliteTable(
    'stations',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        name: text('name').notNull().unique(),
        thermalClass: text('thermal_class', { enum: THERMAL_CLASSES })
            .notNull()
            .default('unclassified'),
        isTransition: integer('is_transition', { mode: 'boolean' }).notNull().default(false),
        createdAt: integer('created_at').notNull(),
    },
    (table) => [
        check(
            'thermal_class_valid',
            sql`${table.thermalClass} IN ('hot', 'cold', 'neutral', 'unclassified')`,
        ),
    ],
)

// One imported spa visit. Totals come from the FIT session message verbatim —
// per-station rollups are derived from station_intervals, never stored here.
export const sessions = sqliteTable(
    'sessions',
    {
        id: text('id').primaryKey(), // uuid v4, generated client-side
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        startedAt: integer('started_at').notNull(), // unix seconds, UTC
        endedAt: integer('ended_at').notNull(),
        utcOffsetS: integer('utc_offset_s'),
        deviceSerial: text('device_serial').notNull(),
        deviceProduct: text('device_product'),
        totalElapsedS: real('total_elapsed_s').notNull(),
        totalTimerS: real('total_timer_s'),
        totalCalories: integer('total_calories'),
        avgHr: integer('avg_hr'),
        maxHr: integer('max_hr'),
        createdAt: integer('created_at').notNull(),
    },
    (table) => [
        // Dedupe key: re-importing the same export is a no-op, not a duplicate.
        unique('sessions_dedupe').on(table.userId, table.deviceSerial, table.startedAt),
        index('idx_sessions_user_time').on(table.userId, desc(table.startedAt)),
    ],
)

// One FIT lap = one stay at one station. user_id is denormalised deliberately:
// every cross-session stat filters by user, and D1 is single-threaded, so index
// directly rather than join through sessions on every read.
export const stationIntervals = sqliteTable(
    'station_intervals',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        sessionId: text('session_id')
            .notNull()
            .references(() => sessions.id, { onDelete: 'cascade' }),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        stationId: integer('station_id')
            .notNull()
            .references(() => stations.id),
        lapIndex: integer('lap_index').notNull(), // FIT lap.message_index, preserves order
        startedAt: integer('started_at').notNull(), // lap.start_time
        endedAt: integer('ended_at').notNull(), // derived: start_time + total_elapsed_time
        elapsedS: real('elapsed_s').notNull(),
        timerS: real('timer_s'),
        avgHr: integer('avg_hr'),
        maxHr: integer('max_hr'),
        calories: integer('calories'),
        cycles: integer('cycles'), // step count, sparse
    },
    (table) => [
        // Doubles as the session+lap-order lookup index — a separate non-unique
        // index on the same columns would be redundant.
        unique('intervals_session_lap').on(table.sessionId, table.lapIndex),
        index('idx_intervals_user_station').on(table.userId, table.stationId, table.startedAt),
    ],
)

export type Station = typeof stations.$inferSelect
export type Session = typeof sessions.$inferSelect
export type StationInterval = typeof stationIntervals.$inferSelect
