import { useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

// A tab left open, or an installed app sitting backgrounded, can go days without a
// navigation — so it has to ask rather than wait to be told.
const CHECK_INTERVAL_MS = 60 * 60 * 1000

// How long to wait for the new worker to take over before reloading regardless.
const CONTROLLER_CHANGE_TIMEOUT_MS = 3000

export type AppUpdate = {
    /** A service worker is waiting: a newer build is ready to take over. */
    needRefresh: boolean
    /** Activate the waiting worker and reload onto the new build. */
    update: () => void
    /**
     * Counts *distinct* waiting workers, not checks. The banner records which value
     * it was dismissed at, so dismissing hides that update while a genuinely new
     * build brings the banner back.
     *
     * Counting checks instead would defeat the whole thing: the same worker stays
     * waiting after Later, so the next hourly poll or tab focus would bump the
     * token and the dismissed banner would return.
     */
    detectionToken: number
}

/**
 * The prompt half of `registerType: 'prompt'`. Nothing auto-updates and the waiting
 * worker never calls `skipWaiting` on its own — it sits there until `update()` runs,
 * so a new build can't reload the page out from under someone mid-import.
 */
export function useAppUpdate(): AppUpdate {
    const [detectionToken, setDetectionToken] = useState(0)
    const [registration, setRegistration] = useState<ServiceWorkerRegistration>()
    // The worker the current token stands for. Identity, not a boolean: `waiting`
    // stays set after the banner is dismissed, so "is something waiting?" is true on
    // every subsequent poll, while "is this a worker we haven't counted?" is not.
    const countedWaiting = useRef<ServiceWorker | null>(null)
    const registrationRef = useRef<ServiceWorkerRegistration | null>(null)

    const noteWaiting = useCallback(function noteWaiting(worker: ServiceWorker | null) {
        if (worker == null || worker === countedWaiting.current) {
            return
        }
        countedWaiting.current = worker
        setDetectionToken((token) => token + 1)
    }, [])

    const {
        needRefresh: [needRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onNeedRefresh() {
            // Both this and the polling below go through noteWaiting, so a worker
            // seen by one is never counted again by the other.
            noteWaiting(registrationRef.current?.waiting ?? null)
        },
        onRegisteredSW(_swUrl, swRegistration) {
            if (swRegistration) {
                registrationRef.current = swRegistration
                setRegistration(swRegistration)
            }
        },
    })

    useEffect(
        function scheduleUpdateChecks() {
            if (registration == null) {
                return
            }

            async function check(current: ServiceWorkerRegistration) {
                // A failed check is a network problem, not something to surface —
                // the next tick or the next focus tries again.
                await current.update().catch(() => {})
                noteWaiting(current.waiting)
            }

            const interval = setInterval(() => void check(registration), CHECK_INTERVAL_MS)

            function onVisibilityChange() {
                if (document.visibilityState === 'visible') {
                    void check(registration!)
                }
            }
            document.addEventListener('visibilitychange', onVisibilityChange)

            return function stopUpdateChecks() {
                clearInterval(interval)
                document.removeEventListener('visibilitychange', onVisibilityChange)
            }
        },
        [registration, noteWaiting],
    )

    return {
        needRefresh,
        update() {
            // `updateServiceWorker(true)` tells the waiting worker to skip waiting
            // and reloads the page when `controllerchange` fires. That event only
            // fires if there was a controller to change — and a page that installed
            // the service worker on this very load is uncontrolled, because nothing
            // here calls `clients.claim()`. In that state the new worker activates,
            // the reload never happens, and the button reads as broken: the banner
            // just sits there.
            //
            // Reload anyway, a moment later. If workbox got there first the timer
            // dies with the page, so this only ever fires when it was needed.
            void updateServiceWorker(true)
            setTimeout(() => location.reload(), CONTROLLER_CHANGE_TIMEOUT_MS)
        },
        detectionToken,
    }
}
