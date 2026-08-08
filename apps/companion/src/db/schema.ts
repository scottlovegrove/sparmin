import { sql } from 'drizzle-orm'
import {
    check,
    index,
    integer,
    real,
    sqliteTable,
    text,
    unique,
    uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { user } from './auth-schema'

// D1 (SQLite) schema. See docs/spa-logger-spec.md §3.
// The `user` table is better-auth's, defined in auth-schema.ts from its CLI —
// note it is singular, and unrelated to the `sessions` table below, which is a
// spa visit rather than a login.

export const THERMAL_CLASSES = ['hot', 'cold', 'neutral', 'unclassified'] as const
export type ThermalClass = (typeof THERMAL_CLASSES)[number]

// Which source (or sources) a session's data came from. A visit recorded by the
// app and later imported from its own FIT export is one session from `both`, not
// two — the two carry different fields and neither is a superset.
export const SESSION_SOURCES = ['fit', 'watch', 'both'] as const
export type SessionSource = (typeof SESSION_SOURCES)[number]

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
        // The watch app's permanent id for this station (SpaActivity.IDS), which
        // is what it sends when it posts a session directly. The FIT carries the
        // display name instead, so the two sources join on different columns and
        // land on the same row. Null for `transition`, which is a lap label
        // rather than a catalogue entry, and for anything auto-inserted from an
        // unrecognised FIT label.
        slug: text('slug'),
        createdAt: integer('created_at').notNull(),
    },
    (table) => [
        check(
            'thermal_class_valid',
            sql`${table.thermalClass} IN ('hot', 'cold', 'neutral', 'unclassified')`,
        ),
        // Deliberately an index rather than .unique() on the column: a unique
        // *constraint* is on drizzle-kit's rebuild-trigger list, and rebuilding
        // this table would take the seed rows every interval references with it.
        uniqueIndex('stations_slug_unique').on(table.slug),
    ],
)

// A watch linked to an account, and the credential it posts sessions with. The
// token is a bearer credential for ingest only — it cannot read, delete, or touch
// account settings — and only its SHA-256 hash is stored, so a database read
// cannot yield a usable one.
export const devices = sqliteTable(
    'devices',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        // The watch's own id for itself, stable across re-links so that linking
        // the same watch twice rotates its token rather than accruing rows.
        installId: text('install_id').notNull(),
        product: text('product'), // 'vivoactive5' | 'fr745' | …
        name: text('name'), // user-editable label
        tokenHash: text('token_hash').notNull(),
        // Learned opportunistically when a FIT import merges into a session this
        // device recorded. Display only — never a key, since no Connect IQ API
        // exposes the FIT serial number to the watch itself.
        serial: text('serial'),
        linkedAt: integer('linked_at').notNull(),
        lastSeenAt: integer('last_seen_at'),
        revokedAt: integer('revoked_at'),
    },
    (table) => [unique('devices_user_install').on(table.userId, table.installId)],
)

// An in-flight pairing attempt. The watch shows `user_code` for a human to type
// into the companion; `device_code` is the secret half that never leaves the
// watch, and is stored only as a hash. Rows are swept on write — there is no
// cron, and the table grows by one row per link attempt.
export const deviceLinkCodes = sqliteTable('device_link_codes', {
    userCode: text('user_code').primaryKey(), // normalised: upper-case, no hyphen
    deviceCodeHash: text('device_code_hash').notNull().unique(),
    installId: text('install_id').notNull(),
    product: text('product'),
    // Null until a signed-in human approves it; approval is what binds the
    // pending code to an account.
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    // Drives the polling discipline: a watch that polls faster than the interval
    // it was given is told to slow down.
    lastPolledAt: integer('last_polled_at'),
    approvedAt: integer('approved_at'),
    consumedAt: integer('consumed_at'),
})

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
        // Null when the session came from the watch: no Connect IQ API exposes
        // file_id.serial_number, so only a FIT import can supply it.
        deviceSerial: text('device_serial'),
        deviceProduct: text('device_product'),
        totalElapsedS: real('total_elapsed_s').notNull(),
        totalTimerS: real('total_timer_s'),
        totalCalories: integer('total_calories'),
        avgHr: integer('avg_hr'),
        maxHr: integer('max_hr'),
        source: text('source', { enum: SESSION_SOURCES }).notNull().default('fit'),
        // The watch's own id for the session. Its uniqueness is what makes a
        // re-send from the watch's offline queue idempotent rather than a
        // duplicate — the queue re-posts after any failure, and a response lost
        // on the way back is indistinguishable from one.
        watchSessionId: text('watch_session_id'),
        deviceId: text('device_id').references(() => devices.id, { onDelete: 'set null' }),
        createdAt: integer('created_at').notNull(),
    },
    (table) => [
        check('session_source_valid', sql`${table.source} IN ('fit', 'watch', 'both')`),
        uniqueIndex('idx_sessions_watch_uuid')
            .on(table.watchSessionId)
            .where(sql`${table.watchSessionId} IS NOT NULL`),
        // The database's own backstop against two concurrent imports of the same
        // export: ingest checks for a duplicate before inserting, but the check
        // and the insert are separate statements, so both requests can pass it.
        // This is the old (user, serial, start) dedupe key, narrowed to the rows
        // it always actually covered — a watch push has no serial, and its
        // idempotency is idx_sessions_watch_uuid's job instead.
        uniqueIndex('idx_sessions_fit_dedupe')
            .on(table.userId, table.deviceSerial, table.startedAt)
            .where(sql`${table.deviceSerial} IS NOT NULL`),
        // Serves both the list's `ORDER BY started_at DESC` and the ingest window
        // match's range scan — SQLite reads an index in either direction, so one
        // ascending index does the work of two.
        index('idx_sessions_user_started').on(table.userId, table.startedAt),
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
        // Only the watch carries this — FIT laps record avg and max, never min.
        minHr: integer('min_hr'),
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

// One browser install that has agreed to be notified. Per install rather than per
// account because that is what the Push API models: permission is granted to an
// origin in one browser, and the endpoint it hands back is only good for that one.
//
// The endpoint is a capability URL — anyone holding it and the two keys can push to
// that device — but unlike a device token it cannot be hashed at rest, because
// sending needs it verbatim. `endpoint_hash` is what leaves the server instead, so
// the settings screen can recognise its own row without the URL travelling.
export const pushSubscriptions = sqliteTable(
    'push_subscriptions',
    {
        id: text('id').primaryKey(), // uuid
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        endpoint: text('endpoint').notNull(),
        // The UA's public key (65 bytes) and auth secret (16), base64url, exactly
        // as PushSubscription.toJSON() serialises them.
        p256dh: text('p256dh').notNull(),
        auth: text('auth').notNull(),
        // "Safari · iPhone". Supplied by the client, which is the only thing that
        // knows its own browser — the Worker sees a user-agent string and little
        // else. Display only.
        label: text('label'),
        createdAt: integer('created_at').notNull(),
    },
    (table) => [
        // A unique index rather than .unique() on the column, for the reason
        // stations_slug_unique is: a unique *constraint* is on drizzle-kit's
        // rebuild-trigger list, and a rebuild of this table would take rows that
        // cost a permission prompt each to earn back.
        uniqueIndex('push_subscriptions_endpoint_unique').on(table.endpoint),
        index('idx_push_subscriptions_user').on(table.userId),
    ],
)

// Which notifications an account wants, as mutes. No row means everything is on,
// so the common case costs no write and a notification type added later defaults
// to on for people who have never opened this screen.
export const notificationPrefs = sqliteTable('notification_prefs', {
    userId: text('user_id')
        .primaryKey()
        .references(() => user.id, { onDelete: 'cascade' }),
    // A session arriving from a linked watch. Account-wide on purpose: it is a
    // statement about what is worth interrupting you for, not about one browser.
    sessionUploaded: integer('session_uploaded', { mode: 'boolean' }).notNull().default(true),
    updatedAt: integer('updated_at').notNull(),
})

export type Station = typeof stations.$inferSelect
export type Session = typeof sessions.$inferSelect
export type StationInterval = typeof stationIntervals.$inferSelect
export type Device = typeof devices.$inferSelect
export type DeviceLinkCode = typeof deviceLinkCodes.$inferSelect
export type PushSubscription = typeof pushSubscriptions.$inferSelect
export type NotificationPrefs = typeof notificationPrefs.$inferSelect
