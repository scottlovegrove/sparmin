import { useSyncExternalStore } from 'react'

function subscribe(onStoreChange: () => void) {
    window.addEventListener('online', onStoreChange)
    window.addEventListener('offline', onStoreChange)
    return function unsubscribe() {
        window.removeEventListener('online', onStoreChange)
        window.removeEventListener('offline', onStoreChange)
    }
}

/**
 * Whether the browser thinks it has a network.
 *
 * `false` is trustworthy — there is genuinely no interface. `true` is not: a captive
 * portal, a dead uplink or a Worker that is down all report online. That case is
 * covered by {@link useStalled} instead, which watches for a request that never
 * comes back.
 */
export function useOnline(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => navigator.onLine,
        // Server snapshot. Nothing renders this app on a server, but React requires
        // the argument; assume online so the shell renders rather than the notice.
        () => true,
    )
}
