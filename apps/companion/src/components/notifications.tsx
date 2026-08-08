import { type PushStatus, usePush } from '../lib/use-push'

export function Notifications() {
    const push = usePush()

    return (
        <section className="card">
            <h2>Notifications</h2>
            <p className="muted small">
                A nudge when a session arrives from your watch, so you know it landed without
                opening the app.
            </p>

            <Availability status={push.status} />

            {(push.status === 'on' || push.status === 'off') && (
                <>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={push.status === 'on'}
                            disabled={push.busy}
                            onChange={() => (push.status === 'on' ? push.disable() : push.enable())}
                        />
                        <span>
                            <span className="toggle-name">Enable push notifications</span>
                            <span className="muted small">
                                {push.status === 'on'
                                    ? 'On for this device'
                                    : 'Off for this device'}
                            </span>
                        </span>
                    </label>

                    {/* Visible even while this device is off, because it is an
                        account setting the user's other devices still obey. */}
                    <div className="toggle-group">
                        <span className="muted small">Types</span>
                        <label className="toggle">
                            <input
                                type="checkbox"
                                checked={push.preferences.sessionUploaded}
                                onChange={(event) =>
                                    push.setPreferences({ sessionUploaded: event.target.checked })
                                }
                            />
                            <span>
                                <span className="toggle-name">Activity uploaded</span>
                                <span className="muted small">
                                    When a session arrives from your watch
                                </span>
                            </span>
                        </label>
                    </div>
                </>
            )}

            {push.otherDevices.length > 0 && (
                <>
                    <p className="muted small other-devices">Also on for</p>
                    <ul className="watches">
                        {push.otherDevices.map((device) => (
                            <li key={device.id}>
                                <span className="watch-name">
                                    {device.label ?? 'Another device'}
                                </span>
                                <span className="muted small watch-meta">
                                    Since {formatSince(device.createdAt)}
                                </span>
                                <button
                                    type="button"
                                    className="link"
                                    disabled={push.busy}
                                    onClick={() => push.forget(device.id)}
                                >
                                    Turn off
                                </button>
                            </li>
                        ))}
                    </ul>
                </>
            )}

            {push.error && <p className="error small">{push.error}</p>}
        </section>
    )
}

function Availability({ status }: { status: PushStatus }) {
    if (status === 'loading') {
        return <p className="muted small">Loading…</p>
    }
    if (status === 'needs-install') {
        // iOS has no Push API in a tab at all — not a denied permission, nothing.
        // Telling this person their browser can't do notifications would be
        // wrong: they are one tap from it working.
        return (
            <p className="muted small">
                Add Sparmin to your Home Screen to turn on notifications. Tap Share, then Add to
                Home Screen.
            </p>
        )
    }
    if (status === 'unsupported') {
        return <p className="muted small">This browser can’t show notifications.</p>
    }
    if (status === 'unconfigured') {
        return <p className="muted small">Notifications aren’t available on this server.</p>
    }
    if (status === 'blocked') {
        // A button can't undo this — only the browser's own site settings can —
        // so offer the instruction rather than a control that does nothing.
        return (
            <p className="muted small">
                Notifications are blocked for this site. Allow them in your browser’s settings to
                turn them on here.
            </p>
        )
    }
    return null
}

function formatSince(createdAt: number): string {
    return new Date(createdAt * 1000).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    })
}
