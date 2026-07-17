import { env } from 'cloudflare:test'
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
export async function resetUsers(): Promise<void> {
    await env.DB.prepare('DELETE FROM sessions').run()
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
