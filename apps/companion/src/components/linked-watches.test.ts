import { describe, expect, it } from 'vitest'
import { formatLastSeen } from './linked-watches'

// Components aren't rendered in this app's tests — there's no jsdom and no
// testing-library. Exported pure helpers are, which is the pattern
// src/components/session-list.test.ts sets.

const NOW = 1783496460

describe('formatLastSeen', () => {
    it('says so plainly when a watch has never sent anything', () => {
        // A watch that linked but never sent is the case worth noticing, so it
        // reads as a statement rather than a blank.
        expect(formatLastSeen(null, NOW)).toBe('Never sent a session')
    })

    it('rounds the last minute or so to just now', () => {
        expect(formatLastSeen(NOW - 30, NOW)).toBe('Last sent a session just now')
    })

    it('counts in minutes within the hour', () => {
        expect(formatLastSeen(NOW - 25 * 60, NOW)).toBe('Last sent a session 25 minutes ago')
    })

    it('switches to hours, singular where it should be', () => {
        expect(formatLastSeen(NOW - 60 * 60, NOW)).toBe('Last sent a session 1 hour ago')
        expect(formatLastSeen(NOW - 5 * 60 * 60, NOW)).toBe('Last sent a session 5 hours ago')
    })

    it('switches to days, singular where it should be', () => {
        expect(formatLastSeen(NOW - 24 * 60 * 60, NOW)).toBe('Last sent a session 1 day ago')
        expect(formatLastSeen(NOW - 9 * 24 * 60 * 60, NOW)).toBe('Last sent a session 9 days ago')
    })

    it('does not report the future when a clock disagrees', () => {
        expect(formatLastSeen(NOW + 120, NOW)).toBe('Last sent a session just now')
    })
})
