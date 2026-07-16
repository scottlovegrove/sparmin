import { magicLinkClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

// No baseURL: the API is served by the same Worker as this page, so it defaults
// to this origin and the session cookie is first-party (spec §1).
export const authClient = createAuthClient({
    plugins: [magicLinkClient()],
})

export const { useSession, signOut } = authClient
