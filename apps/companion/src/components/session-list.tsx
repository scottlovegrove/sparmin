import { useEffect, useState } from 'react'

type SessionRow = {
    id: string
    startedAt: number
    utcOffsetS: number | null
    totalElapsedS: number
    totalCalories: number | null
    avgHr: number | null
    maxHr: number | null
}

type State =
    | { status: 'loading' }
    | { status: 'ready'; sessions: SessionRow[] }
    | { status: 'error'; message: string }

//! Sessions are stored as UTC seconds with the offset the watch recorded, so a
//! visit reads back at the time it actually happened rather than the reader's
//! current timezone.
export function formatWhen(startedAt: number, utcOffsetS: number | null) {
    const local = new Date((startedAt + (utcOffsetS ?? 0)) * 1000)
    return new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
    }).format(local)
}

// Round to minutes first, then split. Splitting first and rounding the remainder
// lets it carry past the hour without anything noticing — 59:59 renders as "60m".
export function formatDuration(seconds: number) {
    const totalMinutes = Math.round(seconds / 60)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

export function SessionList({ reloadKey }: { reloadKey: number }) {
    const [state, setState] = useState<State>({ status: 'loading' })

    useEffect(() => {
        // An import can land while the first load is still in flight, and the
        // older response must not be the one that wins — abort it instead.
        const aborter = new AbortController()

        async function load() {
            try {
                const res = await fetch('/api/sessions', { signal: aborter.signal })
                if (!res.ok) {
                    throw new Error(`The server returned ${res.status}`)
                }
                const body = (await res.json()) as { sessions: SessionRow[] }
                setState({ status: 'ready', sessions: body.sessions })
            } catch (err) {
                if (aborter.signal.aborted) {
                    return
                }
                setState({ status: 'error', message: (err as Error).message })
            }
        }

        void load()
        return () => aborter.abort()
    }, [reloadKey])

    if (state.status === 'loading') {
        return (
            <section className="card">
                <h2>Your sessions</h2>
                <p className="muted">Loading…</p>
            </section>
        )
    }

    if (state.status === 'error') {
        return (
            <section className="card">
                <h2>Your sessions</h2>
                <p className="error">{state.message}</p>
            </section>
        )
    }

    return (
        <section className="card">
            <h2>Your sessions</h2>
            {state.sessions.length === 0 ? (
                <p className="muted">Nothing yet. Import a .fit export to see it here.</p>
            ) : (
                <ul className="sessions">
                    {state.sessions.map((session) => (
                        <li key={session.id}>
                            <span className="when">
                                {formatWhen(session.startedAt, session.utcOffsetS)}
                            </span>
                            <span className="stats muted small">
                                {formatDuration(session.totalElapsedS)}
                                {session.avgHr != null && ` · ${session.avgHr} bpm avg`}
                                {session.maxHr != null && ` · ${session.maxHr} max`}
                                {session.totalCalories != null && ` · ${session.totalCalories} cal`}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    )
}
