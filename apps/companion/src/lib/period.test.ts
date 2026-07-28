import { describe, expect, it } from 'vitest'
import { isoDay, isValidRange, periodDates } from './period'

// Midday on Monday 13 July 2026, so the arithmetic can't be rescued by a
// convenient midnight.
const MON_13_JUL = Date.parse('2026-07-13T12:00:00Z') / 1000

describe('periodDates', () => {
    it('counts today as one of the days on the label', () => {
        // Seven days ending today is today and the six before it — not seven
        // before today, which would be eight days under a button saying seven.
        expect(periodDates({ kind: 'preset', days: 7 }, MON_13_JUL)).toEqual({
            from: '2026-07-07',
            to: '2026-07-13',
        })
    })

    it('spans the longer presets the same way', () => {
        expect(periodDates({ kind: 'preset', days: 30 }, MON_13_JUL).from).toBe('2026-06-14')
        expect(periodDates({ kind: 'preset', days: 90 }, MON_13_JUL).from).toBe('2026-04-15')
        expect(periodDates({ kind: 'preset', days: 365 }, MON_13_JUL).from).toBe('2025-07-14')
    })

    it('is a rolling window, not the calendar year', () => {
        // What the "365 days" label promises: a year back from the day asked,
        // wherever in the year that lands.
        expect(
            periodDates({ kind: 'preset', days: 365 }, Date.parse('2026-01-05T09:00:00Z') / 1000),
        ).toEqual({ from: '2025-01-06', to: '2026-01-05' })
    })

    it('passes a custom range through untouched', () => {
        expect(
            periodDates({ kind: 'custom', from: '2026-02-01', to: '2026-02-29' }, MON_13_JUL),
        ).toEqual({ from: '2026-02-01', to: '2026-02-29' })
    })
})

describe('isValidRange', () => {
    it('accepts a single day', () => {
        expect(isValidRange('2026-07-13', '2026-07-13')).toBe(true)
    })

    it('refuses a range that runs backwards', () => {
        expect(isValidRange('2026-07-13', '2026-07-12')).toBe(false)
    })

    it('refuses a half-filled range', () => {
        // A cleared date input reads as an empty string, not as "no bound".
        expect(isValidRange('', '2026-07-13')).toBe(false)
        expect(isValidRange('2026-07-13', '')).toBe(false)
    })
})

describe('isoDay', () => {
    it('gives the date the API and the date input both want', () => {
        expect(isoDay(MON_13_JUL)).toBe('2026-07-13')
    })
})
