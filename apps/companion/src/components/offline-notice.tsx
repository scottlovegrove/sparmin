// Shown when the app can't reach the server and there's no session yet. The service
// worker precaches the shell, so this screen loads offline where the page previously
// just never painted — but nothing behind it works offline, and saying otherwise
// would be a lie.
export function OfflineNotice() {
    return (
        <section className="card">
            <h1>No connection</h1>
            <p>Sparmin can’t reach the server, so it can’t load your sessions.</p>
            <p className="muted small">
                Nothing is lost — your sessions are stored on the server, and your watch keeps
                recording either way.
            </p>
            {/* A reload, deliberately: there is no state on this screen worth
                keeping, and it re-runs the cached shell and the session fetch by
                exactly the path a cold start would. */}
            <button type="button" className="button" onClick={() => location.reload()}>
                Try again
            </button>
        </section>
    )
}
