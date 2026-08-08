import { describe, expect, it } from 'vitest'
import { parsePushPayload, sessionUploadedNotification } from './push-payload'

describe('sessionUploadedNotification', () => {
    it('says how long the visit was and how many stays it had', () => {
        expect(
            sessionUploadedNotification({ id: 'abc', totalSeconds: 2314, stayCount: 4 }),
        ).toEqual({
            type: 'sessionUploaded',
            title: 'Session saved',
            body: '39m · 4 stays',
            tag: 'session-abc',
            url: '/',
        })
    })

    it('does not say "1 stays"', () => {
        expect(
            sessionUploadedNotification({ id: 'abc', totalSeconds: 600, stayCount: 1 }).body,
        ).toBe('10m · 1 stay')
    })

    it('tags by session, so a retried delivery replaces rather than stacks', () => {
        const first = sessionUploadedNotification({ id: 'one', totalSeconds: 60, stayCount: 1 })
        const again = sessionUploadedNotification({ id: 'one', totalSeconds: 60, stayCount: 1 })
        const other = sessionUploadedNotification({ id: 'two', totalSeconds: 60, stayCount: 1 })

        expect(first.tag).toBe(again.tag)
        expect(first.tag).not.toBe(other.tag)
    })
})

describe('parsePushPayload', () => {
    // The reader runs in a service worker that can be weeks older than the Worker
    // that sent the message — a browser only takes an update when the user accepts
    // the banner. So it has to tolerate a payload from the future, and refuse only
    // what it genuinely cannot show.

    it('reads a payload this version wrote', () => {
        const payload = sessionUploadedNotification({ id: 'abc', totalSeconds: 600, stayCount: 2 })
        expect(parsePushPayload(JSON.stringify(payload))).toEqual(payload)
    })

    it('keeps the fields it knows from a payload carrying ones it does not', () => {
        const parsed = parsePushPayload(
            JSON.stringify({
                title: 'Session saved',
                body: '10m · 2 stays',
                tag: 'session-abc',
                url: '/somewhere',
                somethingAddedLater: { deeply: ['nested'] },
            }),
        )

        expect(parsed).toEqual({
            type: 'sessionUploaded',
            title: 'Session saved',
            body: '10m · 2 stays',
            tag: 'session-abc',
            url: '/somewhere',
        })
    })

    it('falls back rather than dropping the notification over a missing tag or url', () => {
        const parsed = parsePushPayload(JSON.stringify({ title: 'Hello', body: 'There' }))

        expect(parsed?.tag).toBe('sparmin')
        expect(parsed?.url).toBe('/')
    })

    it('refuses what cannot be shown at all', () => {
        // Returning a half-built notification here would show an empty banner;
        // null lets the service worker decline instead.
        for (const raw of [
            '',
            'not json',
            'null',
            '"a string"',
            '[]',
            '{}',
            JSON.stringify({ title: 'No body' }),
            JSON.stringify({ body: 'No title' }),
            JSON.stringify({ title: 1, body: 2 }),
        ]) {
            expect(parsePushPayload(raw), raw).toBeNull()
        }
    })
})
