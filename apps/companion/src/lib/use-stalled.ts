import { useEffect, useState } from 'react'

// Long enough that a slow phone on a slow connection isn't accused of being offline,
// short enough that nobody sits looking at a blank screen wondering.
const STALL_MS = 6000

/**
 * True once `pending` has stayed true for {@link STALL_MS}, and false again the
 * moment it clears.
 *
 * This is the half `navigator.onLine` can't cover: the browser believes it has a
 * network, the request went out, and nothing ever came back. Without it, an app
 * opened behind a captive portal renders a blank shell for ever, because
 * better-auth's `useSession()` simply never settles.
 */
export function useStalled(pending: boolean): boolean {
    const [stalled, setStalled] = useState(false)

    useEffect(
        function startStallTimer() {
            if (!pending) {
                setStalled(false)
                return
            }

            const timer = setTimeout(() => setStalled(true), STALL_MS)
            return function cancelStallTimer() {
                clearTimeout(timer)
            }
        },
        [pending],
    )

    // `pending &&`, not just `stalled`: the effect resets the state, but an effect
    // runs after the render that saw `pending` go false, so returning the raw flag
    // would report a stall for one render after the request actually succeeded —
    // long enough to flash the offline notice at someone whose slow request just
    // came back.
    return pending && stalled
}
