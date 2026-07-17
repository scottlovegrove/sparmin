import { describe, expect, it } from 'vitest'
import { type Visit, currentStreak, visitsPerWeek, weekOf } from './streak'

const DAY = 86400
// Monday 2026-07-13 00:00 UTC — a week boundary, so the edges are testable.
const MON_13_JUL = Date.UTC(2026, 6, 13) / 1000

const at = (offsetDays: number, offsetS: number | null = 0): Visit => ({
    startedAt: MON_13_JUL + offsetDays * DAY,
    utcOffsetS: offsetS,
})

describe('weekOf', () => {
    it('keeps a whole week together', () => {
        const monday = weekOf(at(0))
        for (const day of [0, 1, 2, 3, 4, 5, 6]) {
            expect(weekOf(at(day)), `day ${day}`).toBe(monday)
        }
    })

    it('starts a new week on Monday, not Sunday', () => {
        expect(weekOf(at(7))).toBe(weekOf(at(0)) + 1)
        // The Sunday before belongs to the previous week.
        expect(weekOf(at(-1))).toBe(weekOf(at(0)) - 1)
    })

    it('uses the offset the watch recorded, not the reader’s clock', () => {
        // 23:30 UTC on Sunday is already Monday somewhere an hour ahead — it
        // belongs to the week it was Monday in.
        const sundayLate = { startedAt: MON_13_JUL - 1800, utcOffsetS: 3600 }
        expect(weekOf(sundayLate)).toBe(weekOf(at(0)))
    })
})

describe('currentStreak', () => {
    const now = MON_13_JUL + 2 * DAY // a Wednesday

    it('counts consecutive weeks', () => {
        const visits = [at(1), at(-6), at(-13)] // this week, and the two before
        expect(currentStreak(visits, now)).toBe(3)
    })

    it('survives a current week with nothing in it yet', () => {
        // It's Wednesday and you haven't been. Last week you did. Not broken.
        expect(currentStreak([at(-6), at(-13)], now)).toBe(2)
    })

    it('ends at the first empty week', () => {
        // This week and last, then a gap, then more — the gap is the end of it.
        const visits = [at(1), at(-6), at(-20), at(-27)]
        expect(currentStreak(visits, now)).toBe(2)
    })

    it('counts weeks kept up, not visits made', () => {
        // Four visits, all in one week.
        expect(currentStreak([at(0), at(1), at(2), at(3)], now)).toBe(1)
    })

    it('is nothing when the last visit is long past', () => {
        expect(currentStreak([at(-30)], now)).toBe(0)
    })

    it('is nothing when there are no visits at all', () => {
        expect(currentStreak([], now)).toBe(0)
    })
})

describe('visitsPerWeek', () => {
    it('reads as a rate, so ranges of different lengths compare', () => {
        expect(visitsPerWeek(12, MON_13_JUL - 28 * DAY, MON_13_JUL)).toBe(3)
        expect(visitsPerWeek(3, MON_13_JUL - 7 * DAY, MON_13_JUL)).toBe(3)
    })

    it('is the count over the window on the label, and checkable against it', () => {
        // Six visits, four weeks: three a week would be wrong, and so would
        // anything that quietly measured a different window than the one asked for.
        expect(visitsPerWeek(6, MON_13_JUL - 28 * DAY, MON_13_JUL)).toBe(1.5)
        expect(visitsPerWeek(6, MON_13_JUL - 364 * DAY, MON_13_JUL)).toBe(0.1)
    })

    it('calls once a week once a week', () => {
        // Measuring from the first visit instead of the range gave this 2: the
        // first visit had no time before it to count against.
        expect(visitsPerWeek(2, MON_13_JUL - 14 * DAY, MON_13_JUL)).toBe(1)
    })

    it('does not turn a single visit into a frantic habit', () => {
        // The same bug at its worst: one visit, measured from itself, read as
        // seven a week.
        expect(visitsPerWeek(1, MON_13_JUL - 365 * DAY, MON_13_JUL)).toBeLessThan(0.1)
    })

    it('still reads per week over a few days', () => {
        // Two visits in three days is a fast pace, not two a week.
        expect(visitsPerWeek(2, MON_13_JUL - 3 * DAY, MON_13_JUL)).toBeGreaterThan(4)
    })

    it('is nothing when nothing happened', () => {
        expect(visitsPerWeek(0, MON_13_JUL - 28 * DAY, MON_13_JUL)).toBe(0)
    })
})
