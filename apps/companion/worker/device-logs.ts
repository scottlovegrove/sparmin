import { and, desc, eq, gte, lt, lte } from 'drizzle-orm'
import { deviceLogs, devices } from '../src/db/schema'
import type { DeviceLogPayload } from '../src/lib/device-log-payload'
import { toUnixSeconds } from '../src/lib/watch-payload'
import type { Db } from './db'

/**
 * How long a line is kept.
 *
 * These are read when something has gone wrong and the question is what the watch
 * was doing at the time — which is a question about the last few visits, not the
 * last few years. Long enough to cover a fault noticed weeks after it started,
 * short enough that the table does not grow without end.
 */
export const RETENTION_S = 90 * 24 * 60 * 60

/** The most lines one read returns, and the default when the caller says nothing. */
export const MAX_PAGE_SIZE = 500
export const DEFAULT_PAGE_SIZE = 200

/**
 * Drop lines past the retention window. Called on the write path rather than by a
 * cron, for the same reason `sweepStaleCodes` is: the table only grows when a
 * watch uploads, so that is exactly when it is worth tidying.
 */
function sweepExpired(db: Db, now: number) {
    return db.delete(deviceLogs).where(lt(deviceLogs.recordedAt, now - RETENTION_S))
}

/**
 * Store what a watch just uploaded, and report how much of it was new.
 *
 * Duplicates are dropped by the unique index rather than checked for: the watch
 * re-sends anything it is not certain arrived, so a re-send is ordinary operation
 * and must be a success, not a conflict.
 */
export async function recordDeviceLogs(
    db: Db,
    userId: string,
    deviceId: string,
    payload: DeviceLogPayload,
    now: number,
): Promise<{ stored: number }> {
    const rows = payload.lines.map((line) => ({
        userId,
        deviceId,
        recordedAt: toUnixSeconds(line.at),
        receivedAt: now,
        appVersion: payload.appVersion,
        line: line.text,
    }))

    const inserted = await db
        .insert(deviceLogs)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: deviceLogs.id })

    await sweepExpired(db, now)

    return { stored: inserted.length }
}

export type DeviceLogRow = {
    readonly at: number
    readonly text: string
    readonly deviceId: string
    readonly deviceName: string | null
    readonly deviceProduct: string | null
    readonly appVersion: string | null
}

/**
 * The account's log lines, newest first.
 *
 * Ordered by the watch's clock rather than ours: the sequence being read is the
 * one that happened on the wrist, and an upload delivers a whole buffer at once,
 * so arrival order says nothing useful about it. `id` breaks ties, which keeps two
 * lines written in the same second in the order they were written.
 */
export async function listDeviceLogs(
    db: Db,
    userId: string,
    options: { limit: number; offset: number; deviceId?: string; from?: number; to?: number },
): Promise<DeviceLogRow[]> {
    const filters = [eq(deviceLogs.userId, userId)]
    if (options.deviceId != null) {
        filters.push(eq(deviceLogs.deviceId, options.deviceId))
    }
    if (options.from != null) {
        filters.push(gte(deviceLogs.recordedAt, options.from))
    }
    if (options.to != null) {
        filters.push(lte(deviceLogs.recordedAt, options.to))
    }

    return db
        .select({
            at: deviceLogs.recordedAt,
            text: deviceLogs.line,
            deviceId: deviceLogs.deviceId,
            deviceName: devices.name,
            deviceProduct: devices.product,
            appVersion: deviceLogs.appVersion,
        })
        .from(deviceLogs)
        .innerJoin(devices, eq(devices.id, deviceLogs.deviceId))
        .where(and(...filters))
        .orderBy(desc(deviceLogs.recordedAt), desc(deviceLogs.id))
        .limit(options.limit)
        .offset(options.offset)
}
