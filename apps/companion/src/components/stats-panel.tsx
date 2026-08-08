import { useEffect, useState } from 'react'
import { formatDuration } from '../lib/format-duration'
import {
    DEFAULT_PERIOD,
    isoDay,
    isValidRange,
    PRESETS,
    type Period,
    periodDates,
} from '../lib/period'

type StationTotal = {
    station: string
    thermalClass: string
    visits: number
    seconds: number
}

type Stats = {
    sessions: number
    hotS: number
    coldS: number
    neutralS: number
    perWeek: number
    streakWeeks: number
    stations: StationTotal[]
}

type State =
    | { status: 'loading' }
    | { status: 'ready'; stats: Stats }
    | { status: 'error'; message: string }
    | { status: 'incomplete' }

export function StatsPanel({ reloadKey }: { reloadKey: number }) {
    const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD)
    const [state, setState] = useState<State>({ status: 'loading' })

    const today = isoDay(Math.floor(Date.now() / 1000))
    const { from, to } = periodDates(period, Math.floor(Date.now() / 1000))

    useEffect(() => {
        if (!isValidRange(from, to)) {
            setState({ status: 'incomplete' })
            return
        }
        // A range just made whole again shouldn't still be asking for dates.
        setState((current) => (current.status === 'incomplete' ? { status: 'loading' } : current))
        const aborter = new AbortController()

        async function load() {
            try {
                const res = await fetch(`/api/stats?from=${from}&to=${to}`, {
                    signal: aborter.signal,
                })
                if (!res.ok) {
                    throw new Error(`The server returned ${res.status}`)
                }
                setState({ status: 'ready', stats: (await res.json()) as Stats })
            } catch (err) {
                if (aborter.signal.aborted) {
                    return
                }
                setState({ status: 'error', message: (err as Error).message })
            }
        }

        void load()
        return () => aborter.abort()
    }, [from, to, reloadKey])

    return (
        <section className="card">
            <header className="stats-head">
                <h2>Your habit</h2>
                <div className="ranges" role="group" aria-label="Period">
                    {PRESETS.map((preset) => {
                        const isOn = period.kind === 'preset' && period.days === preset.days
                        return (
                            <button
                                key={preset.label}
                                type="button"
                                className={`range ${isOn ? 'is-on' : ''}`}
                                aria-pressed={isOn}
                                onClick={() => setPeriod({ kind: 'preset', days: preset.days })}
                            >
                                {preset.label}
                            </button>
                        )
                    })}
                    <button
                        type="button"
                        className={`range ${period.kind === 'custom' ? 'is-on' : ''}`}
                        aria-pressed={period.kind === 'custom'}
                        // Seeded with the window already on screen, so the fields
                        // open on what is being looked at rather than on nothing.
                        onClick={() => setPeriod({ kind: 'custom', from, to })}
                    >
                        Custom
                    </button>
                </div>
            </header>

            {period.kind === 'custom' && (
                <div className="custom-range">
                    <label>
                        From
                        <input
                            type="date"
                            value={period.from}
                            max={period.to || today}
                            onChange={(e) => setPeriod({ ...period, from: e.currentTarget.value })}
                        />
                    </label>
                    <label>
                        To
                        <input
                            type="date"
                            value={period.to}
                            min={period.from}
                            max={today}
                            onChange={(e) => setPeriod({ ...period, to: e.currentTarget.value })}
                        />
                    </label>
                </div>
            )}

            {state.status === 'incomplete' && (
                <p className="muted small">Pick a start and end date.</p>
            )}
            {state.status === 'loading' && <p className="muted small">Loading…</p>}
            {state.status === 'error' && <p className="error small">{state.message}</p>}

            {state.status === 'ready' &&
                (state.stats.sessions === 0 ? (
                    <p className="muted small">No visits in this period.</p>
                ) : (
                    <>
                        <ul className="figures">
                            {/* "times", not "visits" or "sessions": a session is a
                                whole trip, so a stop at one station can't be one —
                                and one word doing both jobs is the same confusion a
                                level down. */}
                            <li>
                                <span className="figure">{state.stats.sessions}</span>
                                <span className="muted small">
                                    {state.stats.sessions === 1 ? 'time' : 'times'}
                                </span>
                            </li>
                            <li>
                                <span className="figure">{state.stats.perWeek}</span>
                                <span className="muted small">a week</span>
                            </li>
                            <li>
                                <span className="figure">{state.stats.streakWeeks}</span>
                                <span className="muted small">week streak</span>
                            </li>
                        </ul>

                        <Balance hotS={state.stats.hotS} coldS={state.stats.coldS} />

                        <ul className="station-totals">
                            {state.stats.stations.map((row) => (
                                <li key={row.station} className={row.thermalClass}>
                                    <span className="dot" aria-hidden="true" />
                                    <span className="station">{row.station}</span>
                                    <span className="muted small">
                                        {row.visits} {row.visits === 1 ? 'time' : 'times'}
                                    </span>
                                    <span className="length">{formatDuration(row.seconds)}</span>
                                </li>
                            ))}
                        </ul>
                    </>
                ))}
        </section>
    )
}

//! Heat against cold, as one bar. The cold is the half people skip, and a ratio
//! shows that in a way two separate numbers don't.
function Balance({ hotS, coldS }: { hotS: number; coldS: number }) {
    const total = hotS + coldS
    if (total === 0) {
        return null
    }
    const hotPercent = Math.round((hotS / total) * 100)

    return (
        <div className="balance">
            <div className="balance-bar" aria-hidden="true">
                <span className="hot-part" style={{ width: `${hotPercent}%` }} />
                <span className="cold-part" style={{ width: `${100 - hotPercent}%` }} />
            </div>
            <p className="small muted balance-key">
                <strong>{formatDuration(hotS)}</strong> hot ·{' '}
                <strong>{formatDuration(coldS)}</strong> cold
            </p>
        </div>
    )
}
