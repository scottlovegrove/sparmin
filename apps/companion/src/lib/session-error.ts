// better-auth reports a transport failure and a rejected request through the same
// `error` field, and they mean opposite things to the user.
type SessionError = { status?: number } | null | undefined

/**
 * Whether a failed session request means "the server is not reachable" rather than
 * "the server said no".
 *
 * A 4xx is the server answering: an expired or rejected session is a sign-in
 * problem, and routing it to the offline notice would strand the user on a Try
 * again button that can only ever repeat the same 401.
 *
 * A transport failure has no real status. better-fetch, which better-auth uses,
 * reports one as `status: 500, statusText: 'Fetch Error'` — so anything from 500 up,
 * or with no status at all, is treated as unreachable. A genuine server-side 500 is
 * swept up with it, which is right: the app can't load your sessions either way, and
 * "can't reach the server" is what the notice says.
 */
export function isUnreachable(error: SessionError): boolean {
    if (error == null) {
        return false
    }
    return error.status == null || error.status >= 500
}
