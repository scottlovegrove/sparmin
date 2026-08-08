import { describe, expect, it } from 'vitest'
import { formatWhen } from './session-list'

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
