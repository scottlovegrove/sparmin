import { type FormEvent, useState } from 'react'
import { Link } from 'wouter'
import { authClient, signOut, useListPasskeys } from '../lib/auth-client'
import { ConfirmDialog } from './confirm-dialog'

// Passkeys that live on a synced provider (iCloud Keychain, a password manager)
// survive losing the device; ones bound to a single device don't. Worth saying,
// quietly, so the list isn't just a row of identical names.
function deviceLabel(deviceType: string): string {
    return deviceType === 'multiDevice' ? 'Synced across your devices' : 'This device only'
}

function formatAdded(createdAt: Date | string): string {
    return new Date(createdAt).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    })
}

export function Settings() {
    // The passkey client refetches this list itself after an add or a remove, so
    // there's no reload key to thread through.
    const { data: passkeys, isPending, error: listError } = useListPasskeys()
    const [name, setName] = useState('')
    const [adding, setAdding] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function handleAdd(event: FormEvent) {
        event.preventDefault()
        setAdding(true)
        setError(null)
        try {
            const result = await authClient.passkey.addPasskey({ name: name.trim() || undefined })
            if (result?.error) {
                setError(result.error.message ?? "That passkey couldn't be added — try again")
                return
            }
            setName('')
        } catch {
            // A dismissed or cancelled browser prompt rejects rather than returning
            // an error; without this the button sits on "Adding…" for ever.
            setError('No passkey was created.')
        } finally {
            setAdding(false)
        }
    }

    async function handleRemove(id: string) {
        setError(null)
        try {
            const result = await authClient.passkey.deletePasskey({ id })
            if (result?.error) {
                setError(result.error.message ?? "That passkey couldn't be removed — try again")
            }
        } catch {
            setError("Couldn't reach the server — try again")
        }
    }

    return (
        <main className="shell">
            <header className="bar">
                <span className="brand">Settings</span>
                <Link href="/" className="link">
                    Back
                </Link>
            </header>

            <section className="card">
                <h2>Passkeys</h2>
                <p className="muted small">
                    Sign in with your fingerprint, face or device PIN instead of waiting for an
                    email.
                </p>

                {isPending ? (
                    <p className="muted small">Loading…</p>
                ) : listError ? (
                    <p className="error small">
                        Couldn’t load your passkeys — reload to try again.
                    </p>
                ) : passkeys && passkeys.length > 0 ? (
                    <ul className="passkeys">
                        {passkeys.map((passkey) => (
                            <li key={passkey.id}>
                                <span className="passkey-name">
                                    {passkey.name?.trim() || 'Unnamed passkey'}
                                </span>
                                <span className="muted small passkey-meta">
                                    {deviceLabel(passkey.deviceType)} · added{' '}
                                    {formatAdded(passkey.createdAt)}
                                </span>
                                <button
                                    type="button"
                                    className="link"
                                    onClick={() => void handleRemove(passkey.id)}
                                >
                                    Remove
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="muted small">No passkeys yet.</p>
                )}

                <form onSubmit={handleAdd} className="add-passkey">
                    <label htmlFor="passkey-name">Name for this passkey</label>
                    <input
                        id="passkey-name"
                        type="text"
                        value={name}
                        placeholder="e.g. Work laptop"
                        autoComplete="off"
                        onChange={(event) => setName(event.target.value)}
                    />
                    <button type="submit" className="button" disabled={adding}>
                        {adding ? 'Adding…' : 'Add a passkey'}
                    </button>
                </form>
                {error && <p className="error small">{error}</p>}
            </section>

            <DangerZone />
        </main>
    )
}

// Two prompts before anything happens, then a hard delete — the user asked for
// exactly this, and the data (every session and stat) doesn't come back.
type DeleteStep = 'idle' | 'first' | 'second'

function DangerZone() {
    const [step, setStep] = useState<DeleteStep>('idle')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function handleDelete() {
        setBusy(true)
        setError(null)

        let res: Response
        try {
            res = await fetch('/api/account', { method: 'DELETE' })
        } catch {
            setError("Couldn't reach the server — try again.")
            setStep('idle')
            setBusy(false)
            return
        }
        if (!res.ok) {
            setError("Your account couldn't be deleted — try again.")
            setStep('idle')
            setBusy(false)
            return
        }

        // Deleted — that's terminal. Signing out is only best-effort cleanup of
        // the now-dead cookie: even if it fails, `useSession`'s next fetch 401s
        // and drops the app to the sign-in screen. Don't surface its failure as a
        // delete failure, and leave `busy` set — this component unmounts with the
        // account rather than returning to an interactive state.
        await signOut().catch(() => {})
    }

    return (
        <section className="card">
            <h2>Danger zone</h2>
            <p className="muted small">
                Delete your account and every session, stay and passkey stored with it. This is
                permanent — it can’t be undone.
            </p>
            <button type="button" className="button danger" onClick={() => setStep('first')}>
                Delete account
            </button>
            {error && <p className="error small">{error}</p>}

            {step === 'first' && (
                <ConfirmDialog
                    title="Delete your account?"
                    message="This permanently erases your account and all of your data. It can’t be undone."
                    confirmText="Delete"
                    isDestructive
                    onConfirm={() => setStep('second')}
                    onCancel={() => setStep('idle')}
                />
            )}

            {step === 'second' && (
                <ConfirmDialog
                    title="Are you really sure?"
                    message="Every session, stay and stat will be gone forever. There is no way to get them back."
                    confirmText="Yes, delete everything"
                    busyText="Deleting…"
                    isDestructive
                    busy={busy}
                    onConfirm={() => void handleDelete()}
                    onCancel={() => setStep('idle')}
                />
            )}
        </section>
    )
}
