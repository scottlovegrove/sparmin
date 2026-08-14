import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../worker'
import { RETENTION_S } from '../worker/device-logs'
import { type SignedIn, signIn } from './auth-helper'
import {
    countRows,
    deviceLogPayload,
    getJson,
    linkWatch,
    postDeviceLogs,
    resetUsers,
    resetWithPair,
} from './helpers'

// The watch's own diagnostic log, uploaded next time it has a phone: the only
// trace left when the system terminates the app rather than the app throwing.

type LogsBody = {
    lines: {
        at: number
        text: string
        deviceId: string
        deviceName: string | null
        deviceProduct: string | null
        appVersion: string | null
    }[]
}

let me: SignedIn
let token: string

// The watch formats UTC to the second, so the payload never carries milliseconds.
const isoSeconds = (date: Date) => `${date.toISOString().slice(0, 19)}Z`

describe('a watch uploading its diagnostic log', () => {
    beforeEach(async () => {
        await resetUsers()
        me = await signIn()
        token = (await linkWatch(me)).token
    })

    it('stores each line against the device that sent it', async () => {
        const res = await postDeviceLogs(token, deviceLogPayload())

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ stored: 2 })
        expect(await countRows('device_logs')).toBe(2)
    })

    it('keeps the watch clock and the arrival time apart', async () => {
        await postDeviceLogs(token, deviceLogPayload())

        const row = await env.DB.prepare(
            'SELECT recorded_at, received_at, app_version FROM device_logs ORDER BY recorded_at',
        ).first<{ recorded_at: number; received_at: number; app_version: string }>()

        // 2026-08-14T08:26:18Z, the watch's stamp — not the moment it arrived.
        expect(row?.recorded_at).toBe(1786695978)
        expect(row?.received_at).toBeGreaterThan(0)
        expect(row?.app_version).toBe('0.8.0')
    })

    it('treats a re-send as a success rather than a conflict', async () => {
        await postDeviceLogs(token, deviceLogPayload())

        // The watch re-sends anything it is not certain arrived.
        const again = await postDeviceLogs(token, deviceLogPayload())

        expect(again.status).toBe(200)
        expect(await again.json()).toEqual({ stored: 0 })
        expect(await countRows('device_logs')).toBe(2)
    })

    it('stores only the lines of a partial re-send that are new', async () => {
        await postDeviceLogs(token, deviceLogPayload())

        const res = await postDeviceLogs(
            token,
            deviceLogPayload({
                lines: [
                    { at: '2026-08-14T08:27:18Z', text: 'app: stopping' },
                    { at: '2026-08-14T08:31:02Z', text: 'app: started 0.8.0' },
                ],
            }),
        )

        expect(await res.json()).toEqual({ stored: 1 })
        expect(await countRows('device_logs')).toBe(3)
    })

    it('marks the device as seen, so a watch that only logs still looks alive', async () => {
        await postDeviceLogs(token, deviceLogPayload())

        const row = await env.DB.prepare('SELECT last_seen_at FROM devices').first<{
            last_seen_at: number | null
        }>()
        expect(row?.last_seen_at).toBeGreaterThan(0)
    })

    it('sweeps lines past the retention window, including ones that arrive stale', async () => {
        const stale = new Date((Math.floor(Date.now() / 1000) - RETENTION_S - 60) * 1000)
        const fresh = new Date(Math.floor(Date.now() / 1000) * 1000)

        await postDeviceLogs(
            token,
            deviceLogPayload({
                lines: [
                    { at: isoSeconds(stale), text: 'ancient' },
                    { at: isoSeconds(fresh), text: 'app: started 0.8.0' },
                ],
            }),
        )

        // Both were stored; the sweep that follows the write took the old one.
        const rows = await env.DB.prepare('SELECT line FROM device_logs').all<{ line: string }>()
        expect(rows.results.map((row) => row.line)).toEqual(['app: started 0.8.0'])
    })

    it('refuses a payload with no lines', async () => {
        const res = await postDeviceLogs(token, deviceLogPayload({ lines: [] }))

        expect(res.status).toBe(400)
        expect(await countRows('device_logs')).toBe(0)
    })

    it('refuses an unknown token', async () => {
        const res = await postDeviceLogs('not-a-token', deviceLogPayload())

        expect(res.status).toBe(401)
        expect(await countRows('device_logs')).toBe(0)
    })
})

describe('reading the log back', () => {
    beforeEach(async () => {
        await resetUsers()
        me = await signIn()
        token = (await linkWatch(me)).token
    })

    it('returns the lines newest first, with the device that wrote them', async () => {
        await postDeviceLogs(token, deviceLogPayload())

        const { status, body } = await getJson<LogsBody>('/api/device-logs', me)

        expect(status).toBe(200)
        expect(body.lines.map((line) => line.text)).toEqual([
            'app: stopping',
            'session: 23:46 free 30112',
        ])
        expect(body.lines[0]?.deviceProduct).toBe('vivoactive5')
    })

    it('bounds the range by the watch clock, not the arrival time', async () => {
        await postDeviceLogs(token, deviceLogPayload())

        const { body } = await getJson<LogsBody>(
            '/api/device-logs?from=2026-08-14&to=2026-08-14',
            me,
        )
        expect(body.lines).toHaveLength(2)

        const { body: empty } = await getJson<LogsBody>(
            '/api/device-logs?from=2026-08-15&to=2026-08-16',
            me,
        )
        expect(empty.lines).toHaveLength(0)
    })

    it('filters to one watch when an account has more than one', async () => {
        const other = await linkWatch(me, 'install-b')
        await postDeviceLogs(token, deviceLogPayload())
        await postDeviceLogs(
            other.token,
            deviceLogPayload({ lines: [{ at: '2026-08-14T09:00:00Z', text: 'from the other' }] }),
        )

        const { body } = await getJson<LogsBody>(`/api/device-logs?deviceId=${other.deviceId}`, me)

        expect(body.lines.map((line) => line.text)).toEqual(['from the other'])
    })

    it('rejects a range that ends before it starts', async () => {
        const { status } = await getJson('/api/device-logs?from=2026-08-16&to=2026-08-14', me)

        expect(status).toBe(400)
    })

    it("never shows one account another account's watch", async () => {
        const { me: mine, other } = await resetWithPair()
        const mineToken = (await linkWatch(mine)).token
        await postDeviceLogs(mineToken, deviceLogPayload())

        const { body } = await getJson<LogsBody>('/api/device-logs', other)

        expect(body.lines).toEqual([])
    })

    it('is not reachable with a device token', async () => {
        await postDeviceLogs(token, deviceLogPayload())

        const res = await app.request(
            '/api/device-logs',
            { headers: { Authorization: `Bearer ${token}` } },
            env,
        )

        expect(res.status).toBe(401)
    })
})
