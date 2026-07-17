import { type FormEvent, useState } from 'react'
import { Link } from 'wouter'
import { authClient, useListPasskeys } from '../lib/auth-client'

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
        </main>
    )
}
