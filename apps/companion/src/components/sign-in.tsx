import { type FormEvent, useState } from 'react'
import { authClient } from '../lib/auth-client'

type State = { status: 'idle' | 'sending' | 'sent' } | { status: 'error'; message: string }

export function SignIn() {
    const [email, setEmail] = useState('')
    const [state, setState] = useState<State>({ status: 'idle' })

    async function handleSubmit(event: FormEvent) {
        event.preventDefault()
        setState({ status: 'sending' })

        try {
            const { error } = await authClient.signIn.magicLink({ email, callbackURL: '/' })
            if (error) {
                setState({
                    status: 'error',
                    message: error.message ?? 'Something went wrong sending your link',
                })
                return
            }
            setState({ status: 'sent' })
        } catch {
            // A dropped connection rejects rather than returning an error, and
            // without this the button sits disabled on "Sending…" for ever.
            setState({ status: 'error', message: "Couldn't reach the server — try again" })
        }
    }

    if (state.status === 'sent') {
        return (
            <section className="card">
                <h1>Check your email</h1>
                <p>
                    A sign-in link is on its way to <strong>{email}</strong>. It expires in five
                    minutes.
                </p>
                <p className="muted">
                    Nothing arrived? Check spam, then{' '}
                    <button
                        type="button"
                        className="link"
                        onClick={() => setState({ status: 'idle' })}
                    >
                        try again
                    </button>
                    .
                </p>
            </section>
        )
    }

    return (
        <section className="card">
            <h1>Sparmin</h1>
            <p className="muted">Your spa sessions, from your watch.</p>
            <form onSubmit={handleSubmit}>
                <label htmlFor="email">Email</label>
                <input
                    id="email"
                    type="email"
                    value={email}
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                    onChange={(event) => setEmail(event.target.value)}
                />
                <button type="submit" disabled={state.status === 'sending'}>
                    {state.status === 'sending' ? 'Sending…' : 'Email me a link'}
                </button>
            </form>
            {state.status === 'error' && <p className="error">{state.message}</p>}
            <p className="muted small">No password. We email you a link that signs you in.</p>
        </section>
    )
}
