import { describe, expect, it } from 'vitest'
import { formatDuration, formatWhen } from './session-list'

describe('formatDuration', () => {
    it('reads a typical visit in minutes', () => {
        expect(formatDuration(2313.637)).toBe('39m')
        expect(formatDuration(60)).toBe('1m')
    })

    it('carries a rounded-up minute into the hour', () => {
        // 59:59 is 60 minutes once rounded — it must not read as "60m".
        expect(formatDuration(3599)).toBe('1h 0m')
        expect(formatDuration(7199)).toBe('2h 0m')
    })

    it('splits hours and minutes', () => {
        expect(formatDuration(3600)).toBe('1h 0m')
        expect(formatDuration(5400)).toBe('1h 30m')
    })
})

// The 12 July fixture's session start: 2026-07-12T08:14:32Z, recorded an hour
// ahead of UTC — so the visit happened at 09:14 by the clock on the wall.
const JULY_12_0814_UTC = 1783844072

describe('formatWhen', () => {
    it('shows the time the visit happened, not the reader’s', () => {
        expect(formatWhen(JULY_12_0814_UTC, 3600)).toBe('Sun 12 Jul, 09:14')
    })

    it('falls back to UTC when the watch recorded no offset', () => {
        expect(formatWhen(JULY_12_0814_UTC, null)).toBe('Sun 12 Jul, 08:14')
    })
})
