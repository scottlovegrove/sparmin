import { and, desc, eq, inArray } from 'drizzle-orm'
import { notificationPrefs, pushSubscriptions } from '../src/db/schema'
import { type PushPayload, sessionUploadedNotification } from '../src/lib/push-payload'
import type { Db } from './db'
import { sha256Hex } from './devices'
import { type PushResult, type VapidKeys, sendPush } from './web-push'

/** What the settings screen needs. Never the endpoint — that is a capability URL. */
export type SubscriptionSummary = {
    readonly id: string
    readonly label: string | null
    readonly createdAt: number
    /**
     * SHA-256 of the endpoint. The browser knows its own endpoint, so it can hash
     * that and recognise its row without the URL ever being sent back out.
     */
    readonly endpointHash: string
}

export type NotificationPreferences = {
    readonly sessionUploaded: boolean
}

/** No row means nothing is muted. See the notification_prefs comment in schema.ts. */
const DEFAULT_PREFERENCES: NotificationPreferences = { sessionUploaded: true }

/**
 * The most devices one account can have notifications on for at once.
 *
 * A real person has a handful. The cap is not about them: nothing stops a
 * signed-in client from `PUT`ting thousands of distinct endpoints, and every one
 * of them would then be encrypted and posted to on every single watch upload,
 * inside a `waitUntil` the Worker has to finish. Oldest rows are dropped rather
 * than the write refused, so the browser in front of you always wins.
 */
const MAX_SUBSCRIPTIONS_PER_USER = 20

/**
 * How many pushes are in flight at once.
 *
 * Encryption is a handful of WebCrypto operations per message and each send is an
 * outbound request; firing the whole list at once is a burst of both for no gain,
 * since nothing is waiting on the result.
 */
const SEND_CONCURRENCY = 5

/**
 * The VAPID identity, or null when this deployment has none configured. Absent
 * keys are a working app without push rather than a broken one — the same shape
 * as RESEND_API_KEY and the magic link.
 */
export function vapidKeys(env: Env): VapidKeys | null {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = env
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
        return null
    }
    return {
        publicKey: VAPID_PUBLIC_KEY,
        privateKey: VAPID_PRIVATE_KEY,
        subject: VAPID_SUBJECT,
    }
}

export async function listSubscriptions(db: Db, userId: string): Promise<SubscriptionSummary[]> {
    const rows = await db
        .select({
            id: pushSubscriptions.id,
            label: pushSubscriptions.label,
            createdAt: pushSubscriptions.createdAt,
            endpoint: pushSubscriptions.endpoint,
        })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))

    return Promise.all(
        rows.map(async (row) => ({
            id: row.id,
            label: row.label,
            createdAt: row.createdAt,
            endpointHash: await sha256Hex(row.endpoint),
        })),
    )
}

/**
 * Record this browser's subscription, or update the one already stored for it.
 *
 * Keyed on the endpoint rather than the user: a browser hands back the same
 * endpoint every time until permission is revoked, and a shared machine can move
 * between accounts. Re-pointing the existing row at whoever subscribed last is
 * what stops one person's notifications arriving on another's screen.
 */
export async function saveSubscription(
    db: Db,
    userId: string,
    subscription: {
        readonly endpoint: string
        readonly p256dh: string
        readonly auth: string
        readonly label: string | null
    },
    nowS: number,
): Promise<void> {
    await db
        .insert(pushSubscriptions)
        .values({
            id: crypto.randomUUID(),
            userId,
            endpoint: subscription.endpoint,
            p256dh: subscription.p256dh,
            auth: subscription.auth,
            label: subscription.label,
            createdAt: nowS,
        })
        .onConflictDoUpdate({
            target: pushSubscriptions.endpoint,
            set: {
                userId,
                p256dh: subscription.p256dh,
                auth: subscription.auth,
                label: subscription.label,
                // Not createdAt: the row is the same subscription, and resetting
                // it would make every re-subscribe look new on the settings list.
            },
        })

    await pruneBeyondCap(db, userId, subscription.endpoint)
}

/**
 * Drop the oldest rows once an account is over the cap. Cheap, and on the write
 * path rather than a cron — the same discipline `sweepStaleCodes` uses.
 *
 * The row just written is held back from the candidates rather than trusted to
 * sort first. `createdAt` is unix *seconds*, so a client registering several
 * endpoints inside one second gives every row an identical timestamp and the
 * ordering among them is arbitrary — which would let the browser that just
 * subscribed be the one evicted, turning the toggle on and immediately off again.
 */
async function pruneBeyondCap(db: Db, userId: string, keepEndpoint: string): Promise<void> {
    const rows = await db
        .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))
        .orderBy(desc(pushSubscriptions.createdAt))

    const excess = rows
        .filter((row) => row.endpoint !== keepEndpoint)
        .slice(MAX_SUBSCRIPTIONS_PER_USER - 1)
        .map((row) => row.id)

    if (excess.length > 0) {
        await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, excess))
    }
}

/** Turn this device off, or another of the caller's own devices from this one. */
export async function deleteSubscription(db: Db, userId: string, id: string): Promise<boolean> {
    const deleted = await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userId, userId)))
        .returning({ id: pushSubscriptions.id })
    return deleted.length > 0
}

export async function getPreferences(db: Db, userId: string): Promise<NotificationPreferences> {
    const [row] = await db
        .select({ sessionUploaded: notificationPrefs.sessionUploaded })
        .from(notificationPrefs)
        .where(eq(notificationPrefs.userId, userId))
    return row ?? DEFAULT_PREFERENCES
}

export async function setPreferences(
    db: Db,
    userId: string,
    preferences: NotificationPreferences,
    nowS: number,
): Promise<void> {
    await db
        .insert(notificationPrefs)
        .values({ userId, sessionUploaded: preferences.sessionUploaded, updatedAt: nowS })
        .onConflictDoUpdate({
            target: notificationPrefs.userId,
            set: { sessionUploaded: preferences.sessionUploaded, updatedAt: nowS },
        })
}

/**
 * Notify every device this account has subscribed that a session arrived from
 * their watch.
 *
 * Called from `waitUntil` on the ingest path, so it must not throw and must not
 * matter how long it takes: the watch is waiting on the response, and it re-queues
 * the whole payload on anything that isn't a 2xx.
 */
export async function notifySessionUploaded(
    env: Env,
    db: Db,
    userId: string,
    session: { readonly id: string; readonly totalSeconds: number; readonly stayCount: number },
    nowS: number,
): Promise<void> {
    const keys = vapidKeys(env)
    if (keys == null) {
        return
    }

    // Cheapest question first: a muted account needs no subscription lookup.
    const preferences = await getPreferences(db, userId)
    if (!preferences.sessionUploaded) {
        return
    }

    const targets = await db
        .select({
            id: pushSubscriptions.id,
            endpoint: pushSubscriptions.endpoint,
            p256dh: pushSubscriptions.p256dh,
            auth: pushSubscriptions.auth,
        })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))

    if (targets.length === 0) {
        return
    }

    await deliver(db, keys, targets, sessionUploadedNotification(session), nowS)
}

async function deliver(
    db: Db,
    keys: VapidKeys,
    targets: readonly {
        readonly id: string
        readonly endpoint: string
        readonly p256dh: string
        readonly auth: string
    }[],
    payload: PushPayload,
    nowS: number,
): Promise<void> {
    const body = JSON.stringify(payload)
    const results: { id: string; result: PushResult }[] = []

    // In slices rather than all at once: see SEND_CONCURRENCY.
    for (let start = 0; start < targets.length; start += SEND_CONCURRENCY) {
        const slice = targets.slice(start, start + SEND_CONCURRENCY)
        results.push(
            ...(await Promise.all(
                slice.map(async (target) => ({
                    id: target.id,
                    result: await sendPush({ keys, target, payload: body, nowS }),
                })),
            )),
        )
    }

    // 404/410 is the push service saying that install is gone for good — the app
    // was uninstalled, or permission revoked. Anything else (a timeout, a 500, a
    // rate limit) is temporary and the row stays: dropping a subscription over a
    // blip would silently stop notifications with nothing to show for it.
    const gone = results.filter((entry) => entry.result.isGone).map((entry) => entry.id)
    if (gone.length > 0) {
        await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone))
    }

    // Nothing downstream can see a push fail — it happens after the response, for
    // a user who is not looking — so an outage would otherwise present as
    // notifications quietly stopping. Row ids only: never the endpoint, which is
    // a capability URL, and never the payload.
    const failed = results.filter((entry) => !entry.result.ok && !entry.result.isGone)
    if (failed.length > 0) {
        console.warn(
            JSON.stringify({
                event: 'push_delivery_failed',
                type: payload.type,
                failed: failed.length,
                attempted: results.length,
                statuses: failed.map((entry) => entry.result.status),
                subscriptionIds: failed.map((entry) => entry.id),
            }),
        )
    }
}
