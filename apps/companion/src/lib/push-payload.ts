import { formatDuration } from './format-duration'

// The contract between the Worker, which builds this and encrypts it, and
// src/sw.ts, which decrypts it and shows a notification. It travels as JSON inside
// an encrypted push body, so both ends have to agree on it and neither can be
// updated without the other — a browser can be running last month's service worker
// against today's Worker, so treat this as append-only and keep the reader
// tolerant of fields it doesn't know.

/** Notification types, so a preference can name one. Currently there is one. */
export const NOTIFICATION_TYPES = ['sessionUploaded'] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export type PushPayload = {
    readonly type: NotificationType
    readonly title: string
    readonly body: string
    /**
     * Replaces rather than stacks. Push services retry, and a delivery that
     * arrives twice should leave one notification, not two.
     */
    readonly tag: string
    /** Where a tap lands. */
    readonly url: string
}

/**
 * A session has arrived from a linked watch.
 *
 * There is no per-session route — the session list on `/` opens with the newest
 * visit at the top — so this deliberately points at the root rather than inventing
 * a URL that would 404 into the app shell.
 */
export function sessionUploadedNotification(session: {
    readonly id: string
    readonly totalSeconds: number
    readonly stayCount: number
}): PushPayload {
    const stays = session.stayCount === 1 ? '1 stay' : `${session.stayCount} stays`

    return {
        type: 'sessionUploaded',
        title: 'Session saved',
        body: `${formatDuration(session.totalSeconds)} · ${stays}`,
        tag: `session-${session.id}`,
        url: '/',
    }
}

/**
 * Read a decrypted push body back into a payload, or null if it is not one.
 *
 * Deliberately forgiving about everything except the fields the notification
 * cannot be shown without: an older service worker receiving a newer payload
 * should still show something rather than nothing.
 */
export function parsePushPayload(raw: string): PushPayload | null {
    let value: unknown
    try {
        value = JSON.parse(raw)
    } catch {
        return null
    }

    if (typeof value !== 'object' || value == null) {
        return null
    }
    const candidate = value as Record<string, unknown>
    if (typeof candidate.title !== 'string' || typeof candidate.body !== 'string') {
        return null
    }

    return {
        type: 'sessionUploaded',
        title: candidate.title,
        body: candidate.body,
        tag: typeof candidate.tag === 'string' ? candidate.tag : 'sparmin',
        url: typeof candidate.url === 'string' ? candidate.url : '/',
    }
}
