import { type FormEvent, useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatUserCode, isUserCodeShaped, normaliseUserCode } from '../lib/device-code'
import { watchLabel, watchSubtitle } from '../lib/watch-label'
import { ConfirmDialog } from './confirm-dialog'

type LinkedDevice = {
    readonly id: string
    readonly name: string | null
    readonly product: string | null
    readonly serial: string | null
    readonly linkedAt: number
    readonly lastSeenAt: number | null
}

type PendingLink = {
    readonly product: string | null
    readonly installId: string
    readonly askedSecondsAgo: number
    readonly expiresInS: number
}

type ListState =
    | { readonly status: 'loading' }
    | { readonly status: 'ready'; readonly devices: readonly LinkedDevice[] }
    | { readonly status: 'error' }

//! When a watch was last heard from, in the vaguest terms that are still useful.
//! Exported for its own test — the component itself isn't rendered in tests, in
//! keeping with the rest of this app.
export function formatLastSeen(lastSeenAt: number | null, nowS: number): string {
    if (lastSeenAt == null) {
        return 'Never sent a session'
    }
    const minutes = Math.max(0, Math.round((nowS - lastSeenAt) / 60))
    if (minutes < 2) {
        return 'Last sent a session just now'
    }
    if (minutes < 60) {
        return `Last sent a session ${minutes} minutes ago`
    }
    const hours = Math.round(minutes / 60)
    if (hours < 24) {
        return `Last sent a session ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
    }
    const days = Math.round(hours / 24)
    return `Last sent a session ${days} ${days === 1 ? 'day' : 'days'} ago`
}

export function LinkedWatches() {
    const [state, setState] = useState<ListState>({ status: 'loading' })
    const [reloadKey, setReloadKey] = useState(0)
    const [code, setCode] = useState('')
    const [pending, setPending] = useState<PendingLink | null>(null)
    const [checking, setChecking] = useState(false)
    const [linking, setLinking] = useState(false)
    const [revoking, setRevoking] = useState<LinkedDevice | null>(null)
    // The watch whose name is being edited, and the text in the box. Held
    // separately so cancelling leaves the stored name alone.
    const [renaming, setRenaming] = useState<LinkedDevice | null>(null)
    const [draftName, setDraftName] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // How many watches the list should show once the one just approved appears.
    // Approving does not create the device row — the watch's next poll does — so
    // for a few seconds after a successful link the list is legitimately still
    // one short, and saying "no watches linked yet" then reads as a failure.
    const [expectedCount, setExpectedCount] = useState<number | null>(null)

    useEffect(() => {
        const abort = new AbortController()
        setState({ status: 'loading' })
        fetch('/api/devices', { signal: abort.signal })
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error('failed'))))
            .then((body: { devices: LinkedDevice[] }) =>
                setState({ status: 'ready', devices: body.devices }),
            )
            .catch(() => {
                if (!abort.signal.aborted) {
                    setState({ status: 'error' })
                }
            })
        return () => abort.abort()
    }, [reloadKey])

    // Keep checking until the watch collects its token and appears. It polls
    // every five seconds, so this is a handful of refreshes at most; if it never
    // shows up — the watch went out of range, say — the wait stops rather than
    // spinning for ever, and the list is simply accurate again.
    const awaiting =
        expectedCount != null && state.status === 'ready' && state.devices.length < expectedCount
    useEffect(() => {
        if (expectedCount != null && state.status === 'ready' && !awaiting) {
            setExpectedCount(null)
            return
        }
        if (!awaiting) {
            return
        }
        const timer = setTimeout(() => setReloadKey((key) => key + 1), 2000)
        return () => clearTimeout(timer)
    }, [awaiting, expectedCount, state.status])

    useEffect(() => {
        if (expectedCount == null) {
            return
        }
        // Stop waiting after a while whatever happens, so a watch that never
        // arrives leaves a truthful list rather than a permanent "waiting".
        const giveUp = setTimeout(() => setExpectedCount(null), 30_000)
        return () => clearTimeout(giveUp)
    }, [expectedCount])

    // Look up what is asking before committing to it, so the confirmation can
    // name the watch rather than asking the user to trust a code they typed.
    async function handleCheck(event: FormEvent) {
        event.preventDefault()
        setError(null)
        setChecking(true)
        try {
            const res = await fetch(`/api/device/pending/${normaliseUserCode(code)}`)
            if (res.status === 404) {
                setError('That code has expired or was already used — ask your watch for a new one')
                return
            }
            if (!res.ok) {
                setError("Couldn't reach the server — try again")
                return
            }
            setPending((await res.json()) as PendingLink)
        } catch {
            setError("Couldn't reach the server — try again")
        } finally {
            setChecking(false)
        }
    }

    async function handleApprove() {
        setLinking(true)
        setError(null)
        try {
            const res = await fetch('/api/device/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userCode: normaliseUserCode(code) }),
            })
            if (!res.ok) {
                setError('That code has expired or was already used — ask your watch for a new one')
                return
            }
            setPending(null)
            setCode('')
            setExpectedCount((state.status === 'ready' ? state.devices.length : 0) + 1)
            setReloadKey((key) => key + 1)
        } catch {
            setError("Couldn't reach the server — try again")
        } finally {
            setLinking(false)
        }
    }

    async function handleRename(event: FormEvent) {
        event.preventDefault()
        if (renaming == null) {
            return
        }
        setBusy(true)
        setError(null)
        try {
            const res = await fetch(`/api/devices/${renaming.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: draftName }),
            })
            if (!res.ok) {
                setError("That watch couldn't be renamed — try again")
                return
            }
            setRenaming(null)
            setReloadKey((key) => key + 1)
        } catch {
            setError("Couldn't reach the server — try again")
        } finally {
            setBusy(false)
        }
    }

    async function handleRevoke() {
        if (revoking == null) {
            return
        }
        setBusy(true)
        setError(null)
        try {
            const res = await fetch(`/api/devices/${revoking.id}`, { method: 'DELETE' })
            if (!res.ok) {
                setError("That watch couldn't be removed — try again")
                return
            }
            setRevoking(null)
            setReloadKey((key) => key + 1)
        } catch {
            setError("Couldn't reach the server — try again")
        } finally {
            setBusy(false)
        }
    }

    const nowS = Math.floor(Date.now() / 1000)

    return (
        <section className="card">
            <h2>Watches</h2>
            <p className="muted small">
                A linked watch sends each spa session as you finish it, so there’s nothing to
                export.
            </p>

            {state.status === 'loading' ? (
                <p className="muted small">Loading…</p>
            ) : state.status === 'error' ? (
                <p className="error small">Couldn’t load your watches — reload to try again.</p>
            ) : state.devices.length > 0 || awaiting ? (
                <ul className="watches">
                    {state.devices.map((device) => (
                        <li key={device.id}>
                            <span className="watch-name">{watchLabel(device)}</span>
                            <span className="muted small watch-meta">
                                {[watchSubtitle(device), formatLastSeen(device.lastSeenAt, nowS)]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </span>
                            <button
                                type="button"
                                className="link"
                                onClick={() => {
                                    setRenaming(device)
                                    setDraftName(device.name ?? '')
                                }}
                            >
                                Rename
                            </button>
                            <button
                                type="button"
                                className="link"
                                onClick={() => setRevoking(device)}
                            >
                                Remove
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="muted small">No watches linked yet.</p>
            )}

            <form onSubmit={handleCheck} className="link-watch">
                <label htmlFor="watch-code">Code from your watch</label>
                <input
                    id="watch-code"
                    type="text"
                    value={code}
                    placeholder="e.g. K7QM-4XB9"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={9}
                    // Formatted as they type, so what's on screen matches what's
                    // on the watch rather than only matching once submitted.
                    onChange={(event) => setCode(formatUserCode(event.target.value))}
                />
                <button
                    type="submit"
                    className="button"
                    disabled={checking || !isUserCodeShaped(code)}
                >
                    {checking ? 'Checking…' : 'Link a watch'}
                </button>
            </form>
            {awaiting && (
                <p className="muted small">Approved — waiting for your watch to pick it up…</p>
            )}
            {error && <p className="error small">{error}</p>}

            {pending && (
                <ConfirmDialog
                    title="Link this watch?"
                    message={`${watchLabel({ product: pending.product })} asked to link ${
                        pending.askedSecondsAgo < 60
                            ? 'just now'
                            : `${Math.round(pending.askedSecondsAgo / 60)} minutes ago`
                    }. It will be able to send sessions to this account.`}
                    confirmText="Link it"
                    busy={linking}
                    busyText="Linking…"
                    onConfirm={() => void handleApprove()}
                    onCancel={() => setPending(null)}
                />
            )}

            {renaming && (
                <RenameWatchDialog
                    watch={renaming}
                    value={draftName}
                    busy={busy}
                    onChange={setDraftName}
                    onSubmit={handleRename}
                    onCancel={() => setRenaming(null)}
                />
            )}

            {revoking && (
                <ConfirmDialog
                    title="Remove this watch?"
                    message={`${watchLabel(revoking)} will stop sending sessions. Anything it already sent stays.`}
                    confirmText="Remove it"
                    isDestructive
                    busy={busy}
                    busyText="Removing…"
                    onConfirm={() => void handleRevoke()}
                    onCancel={() => setRevoking(null)}
                />
            )}
        </section>
    )
}

// The one dialog in the app that takes input, so it can't be a ConfirmDialog.
// Same portal, backdrop and panel classes, so it looks like one.
function RenameWatchDialog(props: {
    readonly watch: LinkedDevice
    readonly value: string
    readonly busy: boolean
    readonly onChange: (value: string) => void
    readonly onSubmit: (event: FormEvent) => void
    readonly onCancel: () => void
}) {
    const { watch, value, busy, onChange, onSubmit, onCancel } = props
    const titleId = useId()

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape' && !busy) {
                onCancel()
            }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [busy, onCancel])

    return createPortal(
        <div
            className="overlay"
            onClick={() => {
                if (!busy) {
                    onCancel()
                }
            }}
        >
            <form
                className="modal"
                aria-labelledby={titleId}
                onClick={(event) => event.stopPropagation()}
                onSubmit={onSubmit}
            >
                <h2 id={titleId}>Rename this watch</h2>
                <p className="muted small">
                    Two watches of the same model look identical in this list. Give this one a name
                    you will recognise, or clear the box to go back to its model.
                </p>
                <input
                    type="text"
                    value={value}
                    // The model, so clearing the box shows what it would revert to.
                    placeholder={watchSubtitle(watch) ?? watchLabel(watch)}
                    maxLength={60}
                    autoComplete="off"
                    onChange={(event) => onChange(event.target.value)}
                />
                <div className="modal-actions">
                    <button
                        type="button"
                        className="button secondary"
                        onClick={onCancel}
                        disabled={busy}
                    >
                        Cancel
                    </button>
                    <button type="submit" className="button" disabled={busy}>
                        {busy ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </form>
        </div>,
        document.body,
    )
}
