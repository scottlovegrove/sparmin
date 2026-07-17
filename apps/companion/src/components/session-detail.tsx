import { useEffect, useState } from 'react'
import { type Stay, formatStay, summarise } from '../lib/session-summary'
import { formatDuration } from './session-list'

type Detail = { session: { id: string }; intervals: Stay[] }

type State =
    | { status: 'loading' }
    | { status: 'ready'; stays: Stay[] }
    | { status: 'error'; message: string }

export function SessionDetail({ id }: { id: string }) {
    const [state, setState] = useState<State>({ status: 'loading' })

    useEffect(() => {
        const aborter = new AbortController()

        async function load() {
            try {
                const res = await fetch(`/api/sessions/${id}`, { signal: aborter.signal })
                if (!res.ok) {
                    throw new Error(`The server returned ${res.status}`)
                }
                const body = (await res.json()) as Detail
                setState({ status: 'ready', stays: body.intervals })
            } catch (err) {
                if (aborter.signal.aborted) {
                    return
                }
                setState({ status: 'error', message: (err as Error).message })
            }
        }

        void load()
        return () => aborter.abort()
    }, [id])

    if (state.status === 'loading') {
        return <p className="muted small detail-note">Loading…</p>
    }
    if (state.status === 'error') {
        return <p className="error small detail-note">{state.message}</p>
    }

    const summary = summarise(state.stays)

    // Recordings end with a tiny transition lap the watch closes the session with
    // (spec §4.3). An arrow after the last station points at nothing, so it isn't
    // drawn — it stays in the data, where it's a few seconds and harmless.
    const lastReal = state.stays.findLastIndex((stay) => !stay.isTransition)
    const shown = lastReal === -1 ? state.stays : state.stays.slice(0, lastReal + 1)

    return (
        <div className="detail">
            <ul className="stays">
                {shown.map((stay) =>
                    // The gap between stations goes unnamed on purpose: it might be
                    // a walk, a shower, or standing about, and the recording can't
                    // tell us which. An arrow and a duration say time passed without
                    // claiming what happened in it.
                    stay.isTransition ? (
                        <li key={stay.order} className="gap">
                            <span aria-hidden="true">↓</span>
                            <span>{formatStay(stay.elapsedS)}</span>
                            <span className="sr-only">between stations</span>
                        </li>
                    ) : (
                        <li key={stay.order} className={stay.thermalClass}>
                            <span className="dot" aria-hidden="true" />
                            <span className="station">{stay.station}</span>
                            <span className="length">{formatStay(stay.elapsedS)}</span>
                            <span className="hr muted small">
                                {stay.avgHr == null ? '' : `${stay.avgHr} bpm`}
                            </span>
                        </li>
                    ),
                )}
            </ul>
            {/* Heat, cold and the crossings between them — what the visit was for.
                The time between stations is deliberately absent: we can't say what
                it was, and the session's total is in the row above, so it's the
                remainder for anyone who wants it. */}
            <p className="totals small">
                <strong>{formatDuration(summary.hotS)}</strong> hot ·{' '}
                <strong>{formatDuration(summary.coldS)}</strong> cold
                {summary.neutralS > 0 && <> · {formatDuration(summary.neutralS)} resting</>}
                {summary.contrastCycles > 0 && (
                    <>
                        {' · '}
                        <strong>
                            {summary.contrastCycles}{' '}
                            {summary.contrastCycles === 1 ? 'cycle' : 'cycles'}
                        </strong>
                    </>
                )}
            </p>
        </div>
    )
}
