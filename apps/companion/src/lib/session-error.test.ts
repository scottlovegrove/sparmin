import { describe, expect, it } from 'vitest'
import { isUnreachable } from './session-error'

describe('isUnreachable', () => {
    it('treats a transport failure as unreachable', () => {
        // What better-fetch reports when the request never left the device.
        expect(isUnreachable({ status: 500 })).toBe(true)
        expect(isUnreachable({})).toBe(true)
    })

    it('does not treat a rejected session as unreachable', () => {
        // The server answered. Showing the offline notice here would strand the user
        // on a Try again that can only repeat the same 401 — the sign-in screen is
        // the way out.
        expect(isUnreachable({ status: 401 })).toBe(false)
        expect(isUnreachable({ status: 403 })).toBe(false)
        expect(isUnreachable({ status: 404 })).toBe(false)
    })

    it('is false when nothing went wrong', () => {
        expect(isUnreachable(null)).toBe(false)
        expect(isUnreachable(undefined)).toBe(false)
    })
})
