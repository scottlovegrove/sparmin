import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../worker'
import { type SignedIn, signIn } from './auth-helper'
import {
    approveCode,
    countRows,
    getJson,
    linkWatch,
    pollToken,
    requestCode,
    resetUsers,
    resetWithPair,
} from './helpers'

// The device-code flow: the watch shows a code, a signed-in human types it in,
// and the watch's next poll gets a bearer token. See docs/watch-sync-spec.md §2.

let me: SignedIn

async function pollBody(deviceCode: string) {
    return (await pollToken(deviceCode)).json() as Promise<{
        status: string
        token?: string
        deviceId?: string
    }>
}

describe('linking a watch', () => {
    beforeEach(async () => {
        await resetUsers()
        me = await signIn()
    })

    it('mints a token once a signed-in user approves the code', async () => {
        const { userCode, deviceCode } = await requestCode()

        expect(await pollBody(deviceCode)).toEqual({ status: 'authorization_pending' })
        expect((await approveCode(me, userCode)).status).toBe(200)

        const linked = await pollBody(deviceCode)
        expect(linked.status).toBe('linked')
        expect(linked.token).toEqual(expect.any(String))
        expect(await countRows('devices')).toBe(1)
    })

    it('hands the code back in the form a human reads off a watch', async () => {
        const { userCode } = await requestCode()

        expect(userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{2}$/)
    })

    it('accepts the code however the user types it', async () => {
        const { userCode, deviceCode } = await requestCode()

        expect((await approveCode(me, userCode.replace('-', '').toLowerCase())).status).toBe(200)

        expect((await pollBody(deviceCode)).status).toBe('linked')
    })

    it('stores only a hash of the token, never the token', async () => {
        const { token } = await linkWatch(me)

        const row = await env.DB.prepare('SELECT token_hash FROM devices').first<{
            token_hash: string
        }>()
        expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/)
        expect(row?.token_hash).not.toBe(token)
    })

    it('gives the token out once and once only', async () => {
        const { userCode, deviceCode } = await requestCode()
        await approveCode(me, userCode)
        await pollBody(deviceCode)

        // A replayed poll must not mint a second credential.
        expect((await pollBody(deviceCode)).status).toBe('expired_token')
        expect(await countRows('devices')).toBe(1)
    })

    it('tells a watch polling too fast to slow down', async () => {
        const { deviceCode } = await requestCode()
        await pollBody(deviceCode)

        expect((await pollBody(deviceCode)).status).toBe('slow_down')
    })

    it('refuses an expired code, and says nothing about why', async () => {
        const { userCode, deviceCode } = await requestCode()
        await env.DB.prepare('UPDATE device_link_codes SET expires_at = 1').run()

        expect((await approveCode(me, userCode)).status).toBe(404)
        expect((await pollBody(deviceCode)).status).toBe('expired_token')
    })

    it('answers an unknown device code the same as an expired one', async () => {
        // A poll must not be a way to learn whether a code was ever real.
        expect((await pollBody('never-existed')).status).toBe('expired_token')
    })

    it('refuses an unknown user code without saying it is unknown', async () => {
        const res = await approveCode(me, 'ZZZZ-99')

        expect(res.status).toBe(404)
    })

    it('supersedes a watch’s earlier attempt rather than stacking them', async () => {
        await requestCode('install-a')
        await requestCode('install-a')

        expect(await countRows('device_link_codes')).toBe(1)
    })

    it('sweeps codes nobody is waiting on any more', async () => {
        await requestCode('install-a')
        await env.DB.prepare('UPDATE device_link_codes SET expires_at = 1').run()

        await requestCode('install-b')

        expect(await countRows('device_link_codes')).toBe(1)
    })

    it('rotates the token in place when the same watch links again', async () => {
        const first = await linkWatch(me, 'install-a')
        const second = await linkWatch(me, 'install-a')

        expect(await countRows('devices')).toBe(1)
        expect(second.token).not.toBe(first.token)
    })
})

describe('the pending-code description', () => {
    beforeEach(async () => {
        await resetUsers()
        me = await signIn()
    })

    it('names the watch so the user can recognise their own', async () => {
        const { userCode } = await requestCode('install-a', 'vivoactive5')

        const { status, body } = await getJson<{ product: string; installId: string }>(
            `/api/device/pending/${userCode}`,
            me,
        )

        expect(status).toBe(200)
        expect(body).toMatchObject({ product: 'vivoactive5', installId: 'install-a' })
    })

    it('never returns the device code', async () => {
        const { userCode, deviceCode } = await requestCode()

        const { body } = await getJson<Record<string, unknown>>(
            `/api/device/pending/${userCode}`,
            me,
        )

        expect(JSON.stringify(body)).not.toContain(deviceCode)
    })

    it('is a 404 once the code has been used', async () => {
        const { userCode, deviceCode } = await requestCode()
        await approveCode(me, userCode)
        await pollToken(deviceCode)

        const { status } = await getJson(`/api/device/pending/${userCode}`, me)

        expect(status).toBe(404)
    })
})

describe('managing linked watches', () => {
    it('lists what is linked, and drops it on revoke', async () => {
        await resetUsers()
        me = await signIn()
        const { deviceId } = await linkWatch(me)

        const listed = await getJson<{ devices: { id: string; product: string }[] }>(
            '/api/devices',
            me,
        )
        expect(listed.body.devices).toHaveLength(1)
        expect(listed.body.devices[0]).toMatchObject({ id: deviceId, product: 'vivoactive5' })

        const res = await app.request(
            `/api/devices/${deviceId}`,
            { method: 'DELETE', headers: me.headers },
            env,
        )
        expect(res.status).toBe(204)

        const after = await getJson<{ devices: unknown[] }>('/api/devices', me)
        expect(after.body.devices).toHaveLength(0)
    })

    it('will not let one account revoke another’s watch', async () => {
        const { me: mine, other } = await resetWithPair()
        const { deviceId } = await linkWatch(mine)

        const res = await app.request(
            `/api/devices/${deviceId}`,
            { method: 'DELETE', headers: other.headers },
            env,
        )

        // 404 rather than 403: another account's device id must not be probeable.
        expect(res.status).toBe(404)
        expect(await countRows('devices')).toBe(1)
    })

    it('links the watch to the account that approved it, not the one that asked', async () => {
        const { me: mine, other } = await resetWithPair()
        const { userCode, deviceCode } = await requestCode()

        await approveCode(other, userCode)
        await pollToken(deviceCode)

        expect((await getJson<{ devices: unknown[] }>('/api/devices', mine)).body.devices).toEqual(
            [],
        )
        expect(
            (await getJson<{ devices: unknown[] }>('/api/devices', other)).body.devices,
        ).toHaveLength(1)
    })
})
