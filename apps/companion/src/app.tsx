import { useState } from 'react'
import { Link, Route, Switch } from 'wouter'
import { ImportPanel } from './components/import-panel'
import { SessionList } from './components/session-list'
import { Settings } from './components/settings'
import { SignIn } from './components/sign-in'
import { StatsPanel } from './components/stats-panel'
import { signOut, useSession } from './lib/auth-client'

function Home({ email }: { email: string }) {
    // Bumped after an import so the list refetches rather than going stale.
    const [reloadKey, setReloadKey] = useState(0)

    return (
        <main className="shell">
            <header className="bar">
                <span className="brand">Sparmin</span>
                <span className="muted small">{email}</span>
                <Link href="/settings" className="link">
                    Settings
                </Link>
                <button type="button" className="link" onClick={() => void signOut()}>
                    Sign out
                </button>
            </header>
            <ImportPanel onImported={() => setReloadKey((key) => key + 1)} />
            <StatsPanel reloadKey={reloadKey} />
            {/* Editing a session's laps shifts the derived stats, so refresh the
                page the same way an import does. */}
            <SessionList reloadKey={reloadKey} onChanged={() => setReloadKey((key) => key + 1)} />
        </main>
    )
}

export function App() {
    const { data: session, isPending } = useSession()

    // Blank rather than a flash of the sign-in screen: the session is a cookie
    // round-trip away, and showing "sign in" to someone already signed in reads
    // as being logged out.
    if (isPending) {
        return <main className="shell" />
    }

    // Signed out: the sign-in screen owns every route until there's a session.
    if (session == null) {
        return (
            <main className="shell">
                <SignIn />
            </main>
        )
    }

    return (
        <Switch>
            <Route path="/settings" component={Settings} />
            <Route>
                <Home email={session.user.email} />
            </Route>
        </Switch>
    )
}
