import { useEffect, useState } from 'react'
import { formatDuration } from '../lib/format-duration'
import { SessionDetail } from './session-detail'

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

export function SessionList({
    reloadKey,
    onChanged,
}: {
    reloadKey: number
    onChanged?: () => void
}) {
    const [state, setState] = useState<State>({ status: 'loading' })
    const [openId, setOpenId] = useState<string | null>(null)

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
                    {state.sessions.map((session) => {
                        const isOpen = openId === session.id
                        return (
                            <li key={session.id}>
                                <button
                                    type="button"
                                    className="session-row"
                                    aria-expanded={isOpen}
                                    // One at a time: this is for looking into a
                                    // visit, not comparing two side by side.
                                    onClick={() => setOpenId(isOpen ? null : session.id)}
                                >
                                    <span className="when">
                                        {formatWhen(session.startedAt, session.utcOffsetS)}
                                    </span>
                                    <span className="stats muted small">
                                        {formatDuration(session.totalElapsedS)}
                                        {session.avgHr != null && ` · ${session.avgHr} bpm avg`}
                                        {session.maxHr != null && ` · ${session.maxHr} max`}
                                    </span>
                                    <span className="chevron" aria-hidden="true">
                                        {isOpen ? '▾' : '▸'}
                                    </span>
                                </button>
                                {isOpen && (
                                    <SessionDetail
                                        id={session.id}
                                        onChanged={onChanged}
                                        // The row this detail hangs off is about to
                                        // disappear from the refetched list, so close
                                        // it first — leaving `openId` on a deleted id
                                        // reopens a detail that can only 404.
                                        onDeleted={() => {
                                            setOpenId(null)
                                            // Drop the row here as well as asking for
                                            // a refetch: the visit is gone either way,
                                            // and waiting on the round trip would
                                            // leave it on screen in the meantime.
                                            setState((current) =>
                                                current.status === 'ready'
                                                    ? {
                                                          ...current,
                                                          sessions: current.sessions.filter(
                                                              (row) => row.id !== session.id,
                                                          ),
                                                      }
                                                    : current,
                                            )
                                            onChanged?.()
                                        }}
                                    />
                                )}
                            </li>
                        )
                    })}
                </ul>
            )}
        </section>
    )
}
