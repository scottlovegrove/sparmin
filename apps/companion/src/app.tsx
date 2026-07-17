import { useState } from 'react'
import { ImportPanel } from './components/import-panel'
import { SessionList } from './components/session-list'
import { SignIn } from './components/sign-in'
import { StatsPanel } from './components/stats-panel'
import { signOut, useSession } from './lib/auth-client'

export function App() {
    const { data: session, isPending } = useSession()
    // Bumped after an import so the list refetches rather than going stale.
    const [reloadKey, setReloadKey] = useState(0)

    // Blank rather than a flash of the sign-in screen: the session is a cookie
    // round-trip away, and showing "sign in" to someone already signed in reads
    // as being logged out.
    if (isPending) {
        return <main className="shell" />
    }

    if (session == null) {
        return (
            <main className="shell">
                <SignIn />
            </main>
        )
    }

    return (
        <main className="shell">
            <header className="bar">
                <span className="brand">Sparmin</span>
                <span className="muted small">{session.user.email}</span>
                <button type="button" className="link" onClick={() => void signOut()}>
                    Sign out
                </button>
            </header>
            <ImportPanel onImported={() => setReloadKey((key) => key + 1)} />
            <StatsPanel reloadKey={reloadKey} />
            <SessionList reloadKey={reloadKey} />
        </main>
    )
}
