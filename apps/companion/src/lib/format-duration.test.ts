import { describe, expect, it } from 'vitest'
import { formatDuration } from './format-duration'

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
