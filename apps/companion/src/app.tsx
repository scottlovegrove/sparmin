import { useEffect, useState } from 'react'

type HealthState = 'checking' | 'ok' | 'unreachable'

export function App() {
    const [health, setHealth] = useState<HealthState>('checking')

    useEffect(() => {
        fetch('/api/health')
            .then((res) => res.json() as Promise<{ status: string }>)
            .then((data) => setHealth(data.status === 'ok' ? 'ok' : 'unreachable'))
            .catch(() => setHealth('unreachable'))
    }, [])

    return (
        <main>
            <h1>Sparmin Companion</h1>
            <p>Thermal spa session logger. Scaffold only — nothing to log yet.</p>
            <p>
                API health: <strong>{health}</strong>
            </p>
        </main>
    )
}
