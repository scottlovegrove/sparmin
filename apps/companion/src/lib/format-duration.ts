//! Round to minutes first, then split. Splitting first and rounding the remainder
//! lets it carry past the hour without anything noticing — 59:59 renders as "60m".
//!
//! Lives here rather than beside the session list because the Worker formats the
//! same durations into push notification copy, and importing a component module
//! there would drag React into the Worker bundle.
export function formatDuration(seconds: number) {
    const totalMinutes = Math.round(seconds / 60)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}
