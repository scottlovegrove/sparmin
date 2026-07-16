import type { Context } from 'hono'

// Placeholder identity until better-auth lands and every /api/* route is guarded
// by a real session (docs/spa-logger-spec.md §6). Routes call this rather than
// reading a user id from the request, so swapping in the real session is a change
// here and not at every call site. Nothing is deployed while this is the truth.
export const STUB_USER_ID = 'stub-user'

export function currentUserId(_c: Context): string {
    return STUB_USER_ID
}
