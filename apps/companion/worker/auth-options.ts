import type { BetterAuthOptions } from 'better-auth'

// Options that don't depend on request bindings, shared by the Worker's
// per-request auth instance and the CLI config that generates the schema.
export const authOptions = {
    appName: 'Sparmin',
    // No passwords to forget, leak or reset — you get in with a magic link or a
    // passkey.
    emailAndPassword: { enabled: false },
    session: {
        // Long-lived: this is a log you open every few days, not a bank.
        expiresIn: 60 * 60 * 24 * 30,
        updateAge: 60 * 60 * 24,
        // Registering a passkey normally demands a "fresh" session (re-auth within
        // the last day). With month-long sessions and no password, that would mean
        // emailing yourself a link just to add a passkey a day after signing in.
        // Zero turns the freshness gate off, so any valid session can register one
        // — in keeping with the low-stakes posture above.
        freshAge: 0,
    },
} satisfies BetterAuthOptions
