import { passkeyClient } from '@better-auth/passkey/client'
import { magicLinkClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

// No baseURL: the API is served by the same Worker as this page, so it defaults
// to this origin and the session cookie is first-party (spec §1).
export const authClient = createAuthClient({
    plugins: [magicLinkClient(), passkeyClient()],
})

// `useListPasskeys` is a reactive hook the passkey client adds; it refetches on
// its own after add/delete, so callers don't thread a reload key through.
export const { useSession, signOut, useListPasskeys } = authClient
