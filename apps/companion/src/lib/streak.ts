export type Visit = { startedAt: number; utcOffsetS: number | null }

const DAY = 86400
// 1 January 1970 was a Thursday, so shifting by three days puts the boundary on a
// Monday and every week index starts there.
const MONDAY_SHIFT = 3

//! Which week a visit falls in, counted from the epoch. Uses the offset the watch
//! recorded rather than the reader's timezone: a Sunday-night visit belongs to the
//! week it was a Sunday in, wherever it's later looked at from.
export function weekOf({ startedAt, utcOffsetS }: Visit): number {
    const localDays = Math.floor((startedAt + (utcOffsetS ?? 0)) / DAY)
    return Math.floor((localDays + MONDAY_SHIFT) / 7)
}

//! Consecutive weeks with at least one visit, counting back from now.
//!
//! A streak survives the current week being empty — it's Tuesday and you haven't
//! been yet, which is not a broken streak. It ends at the first week with nothing
//! in it. Two visits in one week are one week, not two: this counts weeks kept up,
//! not visits made.
export function currentStreak(visits: readonly Visit[], now: number): number {
    if (visits.length === 0) {
        return 0
    }
    const weeks = new Set(visits.map(weekOf))
    let week = weekOf({ startedAt: now, utcOffsetS: visits[0].utcOffsetS })

    if (!weeks.has(week)) {
        week -= 1
    }
    let streak = 0
    while (weeks.has(week)) {
        streak += 1
        week -= 1
    }
    return streak
}

//! Visits per week across the range asked for — nothing cleverer.
//!
//! It was briefly measured from the first visit instead, so that asking a year of
//! someone a month into the habit didn't divide by fifty-two and call four a week
//! "0.1". That was worse: a window starting at the first visit gives that visit no
//! time before it, so two visits exactly a week apart — once a week — read as two,
//! and a first-ever visit today read as seven. A rate is a count over a window, and
//! the window has to be the one on the label, or the number can't be checked
//! against anything.
export function visitsPerWeek(visitCount: number, fromS: number, toS: number): number {
    if (visitCount === 0) {
        return 0
    }
    const weeks = Math.max((toS - fromS) / (DAY * 7), 1 / 7)
    return Math.round((visitCount / weeks) * 10) / 10
}
