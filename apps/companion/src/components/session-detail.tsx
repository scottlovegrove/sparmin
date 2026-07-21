import { useEffect, useState } from 'react'
import { type Stay, formatStay, summarise } from '../lib/session-summary'
import { formatDuration } from './session-list'

type Detail = { session: { id: string }; intervals: Stay[] }
type StationOption = { id: number; name: string; isTransition: boolean }

type State =
    | { status: 'loading' }
    | { status: 'ready'; stays: Stay[] }
    | { status: 'error'; message: string }

// One row of the editor: the station it's labelled with now, and the original
// stays folded into it. A row with one member is an untouched (or relabelled)
// lap; several members is a merge, spanning from the first's start to the last's
// end. Members stay in time order, contiguous, as the detail view holds them.
type EditRow = { station: string; members: Stay[] }

// The station catalogue is a fixed seed, so fetch it once for the whole app
// rather than on every session a user opens to edit.
let stationsPromise: Promise<StationOption[]> | null = null
function loadStations(): Promise<StationOption[]> {
    if (stationsPromise == null) {
        stationsPromise = fetch('/api/stations')
            .then((res) => {
                if (!res.ok) {
                    throw new Error(`The server returned ${res.status}`)
                }
                return res.json() as Promise<{ stations: StationOption[] }>
            })
            .then((body) => body.stations)
            // Don't cache a failure — a later edit should get to try again.
            .catch((err) => {
                stationsPromise = null
                throw err
            })
    }
    return stationsPromise
}

function rowElapsed(row: EditRow): number {
    const first = row.members[0]
    const last = row.members[row.members.length - 1]
    return last.endedAt - first.startedAt
}

export function SessionDetail({ id, onChanged }: { id: string; onChanged?: () => void }) {
    const [state, setState] = useState<State>({ status: 'loading' })
    const [stations, setStations] = useState<StationOption[] | null>(null)
    const [rows, setRows] = useState<EditRow[] | null>(null)
    const [saving, setSaving] = useState(false)
    const [editError, setEditError] = useState<string | null>(null)

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

    async function startEditing(stays: Stay[]) {
        setEditError(null)
        try {
            setStations(await loadStations())
        } catch (err) {
            setEditError((err as Error).message)
            return
        }
        // One row per stay, each its own member — the user merges from here.
        setRows(stays.map((stay) => ({ station: stay.station, members: [stay] })))
    }

    function relabel(index: number, station: string) {
        setRows((current) =>
            current == null
                ? current
                : current.map((row, i) => (i === index ? { ...row, station } : row)),
        )
    }

    // Fold a row into the one above it, keeping the upper row's label — so the
    // stray taps in the middle of a stay disappear into it. The first row has
    // nothing above, so it can't merge up.
    function mergeUp(index: number) {
        setRows((current) => {
            if (current == null || index === 0) {
                return current
            }
            const above = current[index - 1]
            const merged: EditRow = {
                station: above.station,
                members: [...above.members, ...current[index].members],
            }
            return [...current.slice(0, index - 1), merged, ...current.slice(index + 1)]
        })
    }

    async function save(editRows: EditRow[]) {
        setSaving(true)
        setEditError(null)
        try {
            // Each row becomes one lap: the original lap orders it folds together,
            // and the label to give it. The server rebuilds the timing.
            const groups = editRows.map((row) => ({
                station: row.station,
                laps: row.members.map((member) => member.order),
            }))
            const res = await fetch(`/api/sessions/${id}/intervals`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groups }),
            })
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { message?: string } | null
                throw new Error(body?.message ?? `The server returned ${res.status}`)
            }
            const body = (await res.json()) as Detail
            setState({ status: 'ready', stays: body.intervals })
            setRows(null)
            // The per-station stats derive from the laps we just changed, so nudge
            // the rest of the page to refetch.
            onChanged?.()
        } catch (err) {
            setEditError((err as Error).message)
        } finally {
            setSaving(false)
        }
    }

    if (rows != null) {
        return (
            <div className="detail">
                <ul className="stays editor">
                    {rows.map((row, index) => (
                        <li key={row.members[0].order}>
                            <select
                                className="stay-station"
                                value={row.station}
                                disabled={saving}
                                onChange={(event) => relabel(index, event.target.value)}
                                aria-label={`Station for lap ${index + 1}`}
                            >
                                {(stations ?? []).map((station) => (
                                    <option key={station.id} value={station.name}>
                                        {station.name}
                                    </option>
                                ))}
                            </select>
                            <span className="length">{formatStay(rowElapsed(row))}</span>
                            {index > 0 ? (
                                <button
                                    type="button"
                                    className="link merge"
                                    disabled={saving}
                                    onClick={() => mergeUp(index)}
                                >
                                    ⤴ merge up
                                </button>
                            ) : (
                                <span />
                            )}
                        </li>
                    ))}
                </ul>
                {editError != null && <p className="error small">{editError}</p>}
                <div className="editor-actions">
                    <button
                        type="button"
                        className="button secondary"
                        disabled={saving}
                        onClick={() => {
                            setRows(null)
                            setEditError(null)
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="button"
                        disabled={saving}
                        onClick={() => void save(rows)}
                    >
                        {saving ? 'Saving…' : 'Save laps'}
                    </button>
                </div>
            </div>
        )
    }

    const stays = state.stays
    const summary = summarise(stays)

    // Recordings end with a tiny transition lap the watch closes the session with
    // (spec §4.3). An arrow after the last station points at nothing, so it isn't
    // drawn — it stays in the data, where it's a few seconds and harmless.
    const lastReal = stays.findLastIndex((stay) => !stay.isTransition)
    const shown = lastReal === -1 ? stays : stays.slice(0, lastReal + 1)

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
            {editError != null && <p className="error small">{editError}</p>}
            <button
                type="button"
                className="link edit-laps"
                onClick={() => void startEditing(stays)}
            >
                Edit laps
            </button>
        </div>
    )
}
