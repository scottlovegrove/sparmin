//! The window the stats are asked over: either one of the presets, or two dates
//! the reader picked. Kept out of the component because it is arithmetic with an
//! off-by-one in it, and arithmetic is worth testing.

const DAY = 86400

export type Period = { kind: 'preset'; days: number } | { kind: 'custom'; from: string; to: string }

// Presets lead because these are the questions anyone actually asks of a habit,
// and picking two dates to ask them is work. Custom is there for the question
// that isn't on the list — a holiday, a month gone by, the run-up to something.
export const PRESETS = [
    { label: '7 days', days: 7 },
    { label: '30 days', days: 30 },
    { label: '90 days', days: 90 },
    // Not "This year": it is a rolling window, and a label saying otherwise is a
    // wrong answer to a question nobody knew they were asking.
    { label: '365 days', days: 365 },
] as const

export const DEFAULT_PERIOD: Period = { kind: 'preset', days: 7 }

//! A day as the API and `<input type="date">` both want it: `YYYY-MM-DD`.
export function isoDay(seconds: number): string {
    return new Date(seconds * 1000).toISOString().slice(0, 10)
}

//! The `from`/`to` pair a period asks the API for.
//!
//! `days - 1`, because both ends are inclusive dates: today counts as one of
//! them. Going back a full 30 from today asks for 31 days and quietly flatters
//! every total under a button that says 30.
export function periodDates(period: Period, nowS: number): { from: string; to: string } {
    if (period.kind === 'custom') {
        return { from: period.from, to: period.to }
    }
    return { from: isoDay(nowS - (period.days - 1) * DAY), to: isoDay(nowS) }
}

//! Whether a pair of dates is worth sending. The inputs can be cleared or typed
//! into, so a half-filled or backwards range reaches here; it is not an error to
//! show the reader, it is a request not to make.
export function isValidRange(from: string, to: string): boolean {
    // ISO days sort lexically, so no parsing is needed to order them.
    return from !== '' && to !== '' && from <= to
}
