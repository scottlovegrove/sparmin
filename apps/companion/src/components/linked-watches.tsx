import { type FormEvent, useEffect, useState } from 'react'
import { formatUserCode, isUserCodeShaped, normaliseUserCode } from '../lib/device-code'
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

//! A watch's model, as something to read rather than an identifier.
export function describeWatch(product: string | null): string {
    if (product == null) {
        return 'A Garmin watch'
    }
    const named: Record<string, string> = {
        vivoactive5: 'vívoactive 5',
        fr745: 'Forerunner 745',
    }
    return named[product] ?? product
}

export function LinkedWatches() {
    const [state, setState] = useState<ListState>({ status: 'loading' })
    const [reloadKey, setReloadKey] = useState(0)
    const [code, setCode] = useState('')
    const [pending, setPending] = useState<PendingLink | null>(null)
    const [checking, setChecking] = useState(false)
    const [linking, setLinking] = useState(false)
    const [revoking, setRevoking] = useState<LinkedDevice | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [linked, setLinked] = useState(false)

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

    // Look up what is asking before committing to it, so the confirmation can
    // name the watch rather than asking the user to trust a code they typed.
    async function handleCheck(event: FormEvent) {
        event.preventDefault()
        setError(null)
        setLinked(false)
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
            setLinked(true)
            setReloadKey((key) => key + 1)
        } catch {
            setError("Couldn't reach the server — try again")
        } finally {
            setLinking(false)
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
            ) : state.devices.length > 0 ? (
                <ul className="watches">
                    {state.devices.map((device) => (
                        <li key={device.id}>
                            <span className="watch-name">
                                {device.name?.trim() || describeWatch(device.product)}
                            </span>
                            <span className="muted small watch-meta">
                                {formatLastSeen(device.lastSeenAt, nowS)}
                            </span>
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
            {linked && <p className="muted small">Linked — your watch should say so too.</p>}
            {error && <p className="error small">{error}</p>}

            {pending && (
                <ConfirmDialog
                    title="Link this watch?"
                    message={`${describeWatch(pending.product)} asked to link ${
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

            {revoking && (
                <ConfirmDialog
                    title="Remove this watch?"
                    message={`${
                        revoking.name?.trim() || describeWatch(revoking.product)
                    } will stop sending sessions. Anything it already sent stays.`}
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
