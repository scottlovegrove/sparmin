import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { expect } from 'vitest'
import type { IngestPayload } from '../src/lib/session-payload'
import app from '../worker'
import { type SignedIn, signIn } from './auth-helper'

// Shared setup for the worker (workerd) test project. Every test here starts from
// a migrated, seeded D1 (see test/apply-migrations.ts) and signs in through the
// real auth flow (see test/auth-helper.ts) — these helpers cut the boilerplate
// that otherwise gets copy-pasted into each suite. See test/AGENTS.md.

// Wipe the per-user data between tests. `sessions` and `user` cascade to
// everything a test creates; `stations` is seed data and must survive.
// `device_link_codes` needs clearing by hand: an unapproved code has no user yet,
// so it survives the cascade and would leak into the next test.
export async function resetUsers(): Promise<void> {
    await env.DB.prepare('DELETE FROM sessions').run()
    await env.DB.prepare('DELETE FROM device_link_codes').run()
    await env.DB.prepare('DELETE FROM user').run()
}

// Wipe, then sign in the two users the ownership/isolation tests need: `me` and a
// genuine second account `other`. Both are real sign-ins, so the user_id foreign
// key is satisfied and a made-up id can't stand in for one.
export async function resetWithPair(): Promise<{ me: SignedIn; other: SignedIn }> {
    await resetUsers()
    const me = await signIn('me@example.com')
    const other = await signIn('other@example.com')
    return { me, other }
}

// COUNT(*) for a table, 0 when empty. Table name is interpolated — tests only,
// never a user value.
export async function countRows(table: string): Promise<number> {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>()
    return row?.n ?? 0
}

// A readable, valid session uuid keyed by a single digit, so a suite can mint
// distinct ids (`uuid(1)`, `uuid(2)`, …) that are easy to eyeball in assertions.
export const uuid = (n: number) => `1111111${n}-2222-4333-8444-555555555555`

const DEFAULT_SESSION_ID = uuid(1)
const DEFAULT_DEVICE = { serial: '1234567890', product: 'vivoactive5' } as const

// The default two-lap circuit: a near-instant transition, then a hot sauna stay.
// Lap starts are derived from `startedAt` so a payload reads consistently at any
// clock offset.
function defaultLaps(startedAt: number): IngestPayload['laps'] {
    return [
        {
            lapIndex: 0,
            station: 'transition',
            startedAt,
            elapsedS: 0.092,
            timerS: 0.092,
            avgHr: null,
            maxHr: null,
            calories: null,
            cycles: null,
        },
        {
            lapIndex: 1,
            station: 'Himalayan salt sauna',
            startedAt: startedAt + 1,
            elapsedS: 899.945,
            timerS: 899.945,
            avgHr: 98,
            maxHr: 119,
            calories: 109,
            cycles: 3,
        },
    ]
}

// Turn a list of station/elapsed stays into laps, each starting a minute after
// the last. For suites that care about which station the time landed on rather
// than the exact per-lap fields.
export function stayLaps(
    startedAt: number,
    stays: readonly { station: string; elapsedS: number }[],
): IngestPayload['laps'] {
    return stays.map((stay, i) => ({
        lapIndex: i,
        station: stay.station,
        startedAt: startedAt + i * 60,
        elapsedS: stay.elapsedS,
        timerS: stay.elapsedS,
        avgHr: null,
        maxHr: null,
        calories: null,
        cycles: null,
    }))
}

export type PayloadOptions = {
    id?: string
    startedAt?: number
    laps?: IngestPayload['laps']
    session?: Partial<IngestPayload['session']>
    device?: IngestPayload['device']
}

// One IngestPayload factory for every suite: sensible defaults, override only
// what the test is actually about. `session` is shallow-merged so a test can pin,
// say, `utcOffsetS` without restating the block.
export function sessionPayload(options: PayloadOptions = {}): IngestPayload {
    const startedAt = options.startedAt ?? 1783496460
    return {
        id: options.id ?? DEFAULT_SESSION_ID,
        device: options.device ?? { ...DEFAULT_DEVICE },
        session: {
            startedAt,
            // Derived the way the parser does it: round(start + total elapsed).
            endedAt: Math.round(startedAt + 2313.637),
            utcOffsetS: 3600,
            totalElapsedS: 2313.637,
            totalTimerS: 2313.637,
            totalCalories: 267,
            avgHr: 99,
            maxHr: 133,
            ...options.session,
        },
        laps: options.laps ?? defaultLaps(startedAt),
    }
}

// POST a session as `who`, returning the raw Response for the caller to assert on.
export async function postSession(who: SignedIn, body: unknown): Promise<Response> {
    return app.request(
        '/api/sessions',
        {
            method: 'POST',
            headers: { ...who.headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        },
        env,
    )
}

// POST a session and assert it was created — for arranging state a test depends
// on, where a non-201 is a bug in the test's premise, not the thing under test.
export async function seedSession(who: SignedIn, body: IngestPayload): Promise<void> {
    const res = await postSession(who, body)
    expect(res.status).toBe(201)
}

// Authenticated GET returning status plus the parsed JSON body, typed by the
// caller. For the many read tests that only need those two things.
export async function getJson<T>(
    path: string,
    who: SignedIn,
): Promise<{ status: number; body: T }> {
    const res = await app.request(path, { headers: who.headers }, env)
    return { status: res.status, body: (await res.json()) as T }
}

// ---- Device linking ----

// Ask for a pairing code the way a watch does: no cookie, because it has none.
export async function requestCode(
    installId = 'install-a',
    product: string | null = 'vivoactive5',
): Promise<{ userCode: string; deviceCode: string; interval: number; expiresIn: number }> {
    const res = await app.request(
        '/api/device/code',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ installId, product }),
        },
        env,
    )
    expect(res.status).toBe(201)
    return res.json()
}

// Poll for the token, again unauthenticated.
export async function pollToken(deviceCode: string): Promise<Response> {
    return app.request(
        '/api/device/token',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceCode }),
        },
        env,
    )
}

// Approve a pending code as a signed-in user.
export async function approveCode(who: SignedIn, userCode: string): Promise<Response> {
    return app.request(
        '/api/device/approve',
        {
            method: 'POST',
            headers: { ...who.headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ userCode }),
        },
        env,
    )
}

// The whole link flow end to end, for suites that need a linked watch rather
// than the linking itself. Returns the bearer token and the device row's id.
export async function linkWatch(
    who: SignedIn,
    installId = 'install-a',
): Promise<{ token: string; deviceId: string }> {
    const { userCode, deviceCode } = await requestCode(installId)
    expect((await approveCode(who, userCode)).status).toBe(200)
    const res = await pollToken(deviceCode)
    const body = (await res.json()) as { status: string; token: string; deviceId: string }
    expect(body.status).toBe('linked')
    return { token: body.token, deviceId: body.deviceId }
}

// A payload shaped the way the watch builds one: ISO timestamps, canonical
// station ids, a per-station minimum heart rate, and none of the calories,
// timer times or serial the FIT carries. Mirrors sessionPayload's defaults so
// the two sources can be compared side by side in a test.
export function watchPayload(
    options: {
        sessionId?: string
        startedAt?: string
        stays?: WatchStay[]
    } = {},
) {
    const stays = options.stays ?? [
        {
            activityId: 'salt_sauna',
            displayName: 'Himalayan salt sauna',
            startedAt: '2026-07-03T15:41:01Z',
            endedAt: '2026-07-03T15:56:01Z',
        },
    ]
    const startedAt = options.startedAt ?? '2026-07-03T15:41:00Z'
    const endedAt = '2026-07-03T16:19:34Z'
    return {
        sessionId: options.sessionId ?? '77777777-2222-4333-8444-555555555555',
        startedAt,
        endedAt,
        totalSeconds: 2314,
        transitionSeconds: 240,
        utcOffsetS: 3600,
        installId: 'install-a',
        appVersion: '0.6.0',
        activities: stays.map((stay) => ({
            activityId: stay.activityId,
            displayName: stay.displayName,
            totalSeconds: 900,
            visits: 1,
            hrAvg: 98,
            hrMax: 119,
            hrMin: 71,
        })),
        segments: walkedSegments(startedAt, endedAt, stays),
    }
}

type WatchStay = { activityId: string; displayName: string; startedAt: string; endedAt: string }

// The lap list as the watch builds it: every stay, and the walk that led to it,
// with a last one closing the session. A walk carries no heart rate — the watch
// only folds readings into a station's lap.
function walkedSegments(startedAt: string, endedAt: string, stays: readonly WatchStay[]) {
    const walk = (from: string, to: string) => ({
        activityId: 'transition',
        startedAt: from,
        endedAt: to,
        hrAvg: null,
        hrMax: null,
        hrMin: null,
    })

    const segments = []
    let cursor = startedAt
    for (const stay of stays) {
        if (stay.startedAt !== cursor) {
            segments.push(walk(cursor, stay.startedAt))
        }
        segments.push({
            activityId: stay.activityId,
            startedAt: stay.startedAt,
            endedAt: stay.endedAt,
            hrAvg: 98,
            hrMax: 119,
            hrMin: 71,
        })
        cursor = stay.endedAt
    }
    if (cursor !== endedAt) {
        segments.push(walk(cursor, endedAt))
    }
    return segments
}

// POST a session the way a linked watch does: a bearer token, no cookie.
//
// A real ExecutionContext, unlike most requests here, because this is the one
// route that uses `waitUntil` — it fires the push notification behind the
// response. Without one `c.executionCtx` throws; without waiting on it the push
// would still be in flight when the test asserts.
export async function postWatchSession(token: string, body: unknown): Promise<Response> {
    const ctx = createExecutionContext()
    const res = await app.request(
        '/api/sessions/watch',
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        },
        env,
        ctx,
    )
    await waitOnExecutionContext(ctx)
    return res
}

// ---- Push notifications ----

// RFC 8291 §5's receiver keys. Real ones on purpose: the send path imports them
// through WebCrypto, so an invented string fails at importKey and every send test
// fails for a reason that has nothing to do with what it is testing.
export const PUSH_KEYS = {
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
} as const

export const PUSH_ORIGIN = 'https://push.example.com'

// A subscription body shaped the way PushSubscription.toJSON() serialises one.
export function pushSubscription(options: { endpoint?: string; label?: string | null } = {}): {
    endpoint: string
    keys: { p256dh: string; auth: string }
    label: string | null
} {
    return {
        endpoint: options.endpoint ?? `${PUSH_ORIGIN}/s/default`,
        keys: { ...PUSH_KEYS },
        label: options.label === undefined ? 'Chrome · MacBook' : options.label,
    }
}

// Register a subscription as `who`, asserting it stuck — for arranging state a
// test depends on rather than for testing the route itself.
export async function subscribePush(
    who: SignedIn,
    body: unknown = pushSubscription(),
): Promise<void> {
    const res = await app.request(
        '/api/push/subscriptions',
        {
            method: 'PUT',
            headers: { ...who.headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        },
        env,
    )
    expect(res.status).toBe(204)
}

// Mute or unmute a notification type as `who`.
export async function setPushPreferences(
    who: SignedIn,
    preferences: { sessionUploaded: boolean },
): Promise<void> {
    const res = await app.request(
        '/api/push/preferences',
        {
            method: 'PATCH',
            headers: { ...who.headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(preferences),
        },
        env,
    )
    expect(res.status).toBe(204)
}
