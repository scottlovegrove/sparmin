import type { BetterAuthOptions } from 'better-auth'

// Options that don't depend on request bindings, shared by the Worker's
// per-request auth instance and the CLI config that generates the schema.
export const authOptions = {
    appName: 'Sparmin',
    // Magic link only: no passwords to forget, leak or reset.
    emailAndPassword: { enabled: false },
    session: {
        // Long-lived: this is a log you open every few days, not a bank.
        expiresIn: 60 * 60 * 24 * 30,
        updateAge: 60 * 60 * 24,
    },
} satisfies BetterAuthOptions
