import { useEffect, useState } from 'react'
import { formatDuration } from './session-list'

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

// Presets rather than a date picker: these are the questions anyone actually asks
// of a habit, and picking two dates to ask them is work.
const RANGES = [
    { label: '30 days', days: 30 },
    { label: '90 days', days: 90 },
    { label: 'This year', days: 365 },
] as const

const isoDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10)

export function StatsPanel({ reloadKey }: { reloadKey: number }) {
    const [days, setDays] = useState<number>(30)
    const [state, setState] = useState<State>({ status: 'loading' })

    useEffect(() => {
        const aborter = new AbortController()

        async function load() {
            const now = Math.floor(Date.now() / 1000)
            const from = isoDay(now - days * 86400)
            try {
                const res = await fetch(`/api/stats?from=${from}&to=${isoDay(now)}`, {
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
    }, [days, reloadKey])

    return (
        <section className="card">
            <header className="stats-head">
                <h2>Your habit</h2>
                <div className="ranges" role="group" aria-label="Period">
                    {RANGES.map((range) => (
                        <button
                            key={range.days}
                            type="button"
                            className={`range ${days === range.days ? 'is-on' : ''}`}
                            aria-pressed={days === range.days}
                            onClick={() => setDays(range.days)}
                        >
                            {range.label}
                        </button>
                    ))}
                </div>
            </header>

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
