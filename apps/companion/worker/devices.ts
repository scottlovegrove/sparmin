import { and, desc, eq, gt, isNull, lt, ne, or } from 'drizzle-orm'
import { deviceLinkCodes, devices } from '../src/db/schema'
import { generateUserCode, normaliseUserCode } from '../src/lib/device-code'
import type { Db } from './db'

// How long a pairing code is good for, and how often the watch should ask. Ten
// minutes is long enough to walk to a phone and sign in, short enough that an
// abandoned attempt is not left standing.
export const LINK_CODE_TTL_S = 600
export const POLL_INTERVAL_S = 5

// A consumed code is kept briefly so a duplicated poll can be told "already
// linked" rather than "never heard of it", then swept.
const CONSUMED_GRACE_S = 3600

//! SHA-256, hex. Both secrets in this flow — the device code and the token it
//! becomes — are stored only as this, so a database read cannot yield a usable
//! credential (§2.4). There is no timing concern in the comparison: the hash is
//! the lookup key, and producing one requires the preimage already.
export async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

//! 32 bytes of CSPRNG, base64url. Used for the device code and the device token
//! — the two secrets no human ever reads, as distinct from the six-character
//! user code, which one does.
export function randomSecret(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    return btoa(String.fromCharCode(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '')
}

//! Clear out attempts nobody is waiting on any more. Called on the write path
//! rather than by a cron: the table only grows when someone starts a link, so
//! that is exactly when it is worth tidying.
function sweepStaleCodes(db: Db, now: number) {
    return db
        .delete(deviceLinkCodes)
        .where(
            or(
                lt(deviceLinkCodes.expiresAt, now),
                lt(deviceLinkCodes.consumedAt, now - CONSUMED_GRACE_S),
            ),
        )
}

export type LinkRequest = { installId: string; product: string | null }

//! Open a pairing attempt and hand back the pair of codes: one for the watch to
//! show, one for it to keep.
//!
//! A watch only ever has one attempt in flight, so requesting again supersedes
//! the last one rather than accumulating. That is also what bounds the table:
//! the only unauthenticated write here cannot leave more than one row per device.
export async function openLinkRequest(
    db: Db,
    request: LinkRequest,
    now: number,
): Promise<{ userCode: string; deviceCode: string; expiresIn: number; interval: number }> {
    const deviceCode = randomSecret()
    const deviceCodeHash = await sha256Hex(deviceCode)

    // Astronomically unlikely to collide, but a collision would hand one watch
    // another's attempt, so retry rather than trust the odds.
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const userCode = generateUserCode()
        const [inserted] = await db
            .insert(deviceLinkCodes)
            .values({
                userCode,
                deviceCodeHash,
                installId: request.installId,
                product: request.product,
                createdAt: now,
                expiresAt: now + LINK_CODE_TTL_S,
            })
            .onConflictDoNothing()
            .returning({ userCode: deviceLinkCodes.userCode })
        if (inserted != null) {
            await db.batch([
                sweepStaleCodes(db, now),
                // Supersede this device's own earlier attempt, if any. Keyed on
                // the code rather than the timestamp: two requests a moment
                // apart share a second, and comparing `created_at` would leave
                // the older row standing.
                db
                    .delete(deviceLinkCodes)
                    .where(
                        and(
                            eq(deviceLinkCodes.installId, request.installId),
                            isNull(deviceLinkCodes.consumedAt),
                            ne(deviceLinkCodes.userCode, inserted.userCode),
                        ),
                    ),
            ])
            return {
                userCode: inserted.userCode,
                deviceCode,
                expiresIn: LINK_CODE_TTL_S,
                interval: POLL_INTERVAL_S,
            }
        }
    }
    throw new Error('Could not allocate a device link code')
}

export type PendingLink = {
    product: string | null
    installId: string
    askedSecondsAgo: number
    expiresInS: number
}

//! What is asking to be linked, so the confirmation screen can name it. Returns
//! only what a human needs to recognise their own watch — never the device code,
//! which is the secret half.
export async function describePending(
    db: Db,
    userCode: string,
    now: number,
): Promise<PendingLink | null> {
    const [row] = await db
        .select({
            product: deviceLinkCodes.product,
            installId: deviceLinkCodes.installId,
            createdAt: deviceLinkCodes.createdAt,
            expiresAt: deviceLinkCodes.expiresAt,
        })
        .from(deviceLinkCodes)
        .where(
            and(
                eq(deviceLinkCodes.userCode, normaliseUserCode(userCode)),
                isNull(deviceLinkCodes.approvedAt),
                isNull(deviceLinkCodes.consumedAt),
                gt(deviceLinkCodes.expiresAt, now),
            ),
        )
        .limit(1)
    if (row == null) {
        return null
    }
    return {
        product: row.product,
        installId: row.installId,
        askedSecondsAgo: now - row.createdAt,
        expiresInS: row.expiresAt - now,
    }
}

//! Bind a pending code to the signed-in account. This is the only step that
//! needs a human, and it is what makes the flow safe: nothing links without
//! someone authenticated saying so.
export async function approveLink(
    db: Db,
    userCode: string,
    userId: string,
    now: number,
): Promise<boolean> {
    const claimed = await db
        .update(deviceLinkCodes)
        .set({ userId, approvedAt: now })
        .where(
            and(
                eq(deviceLinkCodes.userCode, normaliseUserCode(userCode)),
                isNull(deviceLinkCodes.approvedAt),
                isNull(deviceLinkCodes.consumedAt),
                gt(deviceLinkCodes.expiresAt, now),
            ),
        )
        .returning({ userCode: deviceLinkCodes.userCode })
    return claimed.length > 0
}

export type PollResult =
    | { status: 'authorization_pending' }
    | { status: 'slow_down' }
    | { status: 'expired_token' }
    | { status: 'linked'; token: string; deviceId: string }

//! The watch asking whether anyone has approved it yet.
//!
//! The claim is a single conditional UPDATE rather than a read followed by a
//! write, so two polls arriving together cannot both mint a token.
export async function pollLink(db: Db, deviceCode: string, now: number): Promise<PollResult> {
    const deviceCodeHash = await sha256Hex(deviceCode)
    const [row] = await db
        .select({
            userCode: deviceLinkCodes.userCode,
            userId: deviceLinkCodes.userId,
            installId: deviceLinkCodes.installId,
            product: deviceLinkCodes.product,
            expiresAt: deviceLinkCodes.expiresAt,
            approvedAt: deviceLinkCodes.approvedAt,
            consumedAt: deviceLinkCodes.consumedAt,
            lastPolledAt: deviceLinkCodes.lastPolledAt,
        })
        .from(deviceLinkCodes)
        .where(eq(deviceLinkCodes.deviceCodeHash, deviceCodeHash))
        .limit(1)

    // An unknown code and an expired one are the same answer on purpose: a poll
    // is not a way to find out whether a code was ever real.
    if (row == null || row.expiresAt <= now || row.consumedAt != null) {
        return { status: 'expired_token' }
    }
    if (row.approvedAt == null || row.userId == null) {
        // Throttling applies to waiting, not to collecting: a watch that polls
        // early is told to slow down, but one whose code was approved a moment
        // ago gets its token rather than another five seconds of waiting.
        if (row.lastPolledAt != null && now - row.lastPolledAt < POLL_INTERVAL_S) {
            return { status: 'slow_down' }
        }
        await db
            .update(deviceLinkCodes)
            .set({ lastPolledAt: now })
            .where(eq(deviceLinkCodes.userCode, row.userCode))
        return { status: 'authorization_pending' }
    }

    const [claimed] = await db
        .update(deviceLinkCodes)
        .set({ consumedAt: now })
        .where(and(eq(deviceLinkCodes.userCode, row.userCode), isNull(deviceLinkCodes.consumedAt)))
        .returning({ userId: deviceLinkCodes.userId })
    if (claimed == null) {
        // Another poll got there first; it holds the only copy of the token.
        return { status: 'expired_token' }
    }

    const token = randomSecret()
    const deviceId = crypto.randomUUID()
    const [device] = await db
        .insert(devices)
        .values({
            id: deviceId,
            userId: row.userId,
            installId: row.installId,
            product: row.product,
            tokenHash: await sha256Hex(token),
            linkedAt: now,
        })
        // Linking a watch that is already linked rotates its token in place. The
        // watch's id for itself is stable, so this is a re-link, not a new device.
        .onConflictDoUpdate({
            target: [devices.userId, devices.installId],
            set: {
                tokenHash: await sha256Hex(token),
                product: row.product,
                linkedAt: now,
                revokedAt: null,
            },
        })
        .returning({ id: devices.id })

    return { status: 'linked', token, deviceId: device.id }
}

//! The account's linked watches, newest first. Revoked ones are gone, not listed
//! as revoked — the user revoked them.
export async function listDevices(db: Db, userId: string) {
    return db
        .select({
            id: devices.id,
            name: devices.name,
            product: devices.product,
            serial: devices.serial,
            linkedAt: devices.linkedAt,
            lastSeenAt: devices.lastSeenAt,
        })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
        .orderBy(desc(devices.linkedAt))
}

//! Revoke a watch. Immediate: the next thing it posts gets a 401.
export async function revokeDevice(
    db: Db,
    userId: string,
    deviceId: string,
    now: number,
): Promise<boolean> {
    const revoked = await db
        .update(devices)
        .set({ revokedAt: now })
        .where(and(eq(devices.id, deviceId), eq(devices.userId, userId), isNull(devices.revokedAt)))
        .returning({ id: devices.id })
    return revoked.length > 0
}

//! Resolve a bearer token to the account it posts for. The only credential check
//! on the ingest path, and deliberately narrow: a revoked device resolves to
//! nothing, the same as one that never existed.
export async function deviceForToken(db: Db, token: string) {
    const [row] = await db
        .select({ id: devices.id, userId: devices.userId, product: devices.product })
        .from(devices)
        .where(and(eq(devices.tokenHash, await sha256Hex(token)), isNull(devices.revokedAt)))
        .limit(1)
    return row ?? null
}

//! Note that a device is still talking to us, so the settings screen can show a
//! watch that has quietly stopped.
export function markDeviceSeen(db: Db, deviceId: string, now: number) {
    return db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, deviceId))
}
