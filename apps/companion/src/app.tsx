import { useState } from 'react'
import { Link, Route, Switch } from 'wouter'
import { ImportPanel } from './components/import-panel'
import { OfflineNotice } from './components/offline-notice'
import { SessionList } from './components/session-list'
import { Settings } from './components/settings'
import { SignIn } from './components/sign-in'
import { StatsPanel } from './components/stats-panel'
import { UpdateBanner } from './components/update-banner'
import { signOut, useSession } from './lib/auth-client'
import { isUnreachable } from './lib/session-error'
import { useOnline } from './lib/use-online'
import { useStalled } from './lib/use-stalled'

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
    const { data: session, isPending, error } = useSession()
    const online = useOnline()
    const stalled = useStalled(isPending)

    // Three signals, because no one of them is enough.
    //
    // The session error does most of the work: offline, the fetch doesn't hang, it
    // rejects in about a millisecond. Without it the request simply resolves to "no
    // session" and the app offers the sign-in screen to someone who can't reach the
    // server — inviting them to type an email that silently goes nowhere, which is
    // worse than saying nothing.
    //
    // `!online` catches the case before a request is even attempted, and `stalled`
    // catches the opposite of a fast failure: a connection that is accepted and then
    // never answered, which is what a captive portal usually does.
    //
    // Only while signed out or still resolving. Once there is a session, a dropped
    // connection is the individual panels' problem — they already say "Couldn't
    // reach the server" — and swapping the whole app for a notice would throw away
    // whatever the user was in the middle of.
    const unreachable = session == null && (!online || stalled || isUnreachable(error))

    return (
        <>
            <UpdateBanner />
            <Routed session={session} isPending={isPending} unreachable={unreachable} />
        </>
    )
}

type RoutedProps = {
    session: ReturnType<typeof useSession>['data']
    isPending: boolean
    unreachable: boolean
}

function Routed({ session, isPending, unreachable }: RoutedProps) {
    // Before the pending check: offline, the session request never settles, so
    // waiting on it would leave a blank shell for ever.
    if (unreachable) {
        return (
            <main className="shell">
                <OfflineNotice />
            </main>
        )
    }

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
