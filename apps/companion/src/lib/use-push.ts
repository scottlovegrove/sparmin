import { useCallback, useEffect, useRef, useState } from 'react'
import { describeBrowser } from './push-label'

// Push subscription state for *this* browser, plus the account-wide preferences
// and the other devices, which the settings card shows together.
//
// The master toggle is per browser install because that is what the Push API
// models: permission belongs to an origin in one browser and the endpoint it
// returns is good only for that one. An account-wide flag would show "on" on a
// device that will never buzz.

export type PushSubscriptionRow = {
    readonly id: string
    readonly label: string | null
    readonly createdAt: number
    readonly endpointHash: string
}

export type NotificationPreferences = {
    readonly sessionUploaded: boolean
}

/**
 * Why the toggle looks the way it does. Each of these is a different sentence to
 * the user, and three of them are not fixable by pressing anything.
 */
export type PushStatus =
    /** Still working out which of the below applies. */
    | 'loading'
    /** No Push API at all — an old browser, or a desktop Safari before 16.4. */
    | 'unsupported'
    /** iOS: the Push API exists only once the app is on the home screen. */
    | 'needs-install'
    /** This deployment has no VAPID keys, so there is nothing to subscribe to. */
    | 'unconfigured'
    /** Permission was refused. A button cannot undo this; browser settings can. */
    | 'blocked'
    | 'off'
    | 'on'

export type Push = {
    readonly status: PushStatus
    readonly preferences: NotificationPreferences
    /** Every subscribed device except this one. */
    readonly otherDevices: readonly PushSubscriptionRow[]
    readonly busy: boolean
    readonly error: string | null
    readonly enable: () => void
    readonly disable: () => void
    readonly setPreferences: (preferences: NotificationPreferences) => void
    readonly forget: (id: string) => void
}

type Config = {
    publicKey: string | null
    preferences: NotificationPreferences
    subscriptions: PushSubscriptionRow[]
}

function isSupported(): boolean {
    return (
        typeof navigator !== 'undefined' &&
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window
    )
}

/**
 * iOS gives an installed web app the Push API and a Safari tab nothing at all —
 * not a `denied` permission, but no `PushManager` on `window`. So an iPhone that
 * hasn't installed the app is indistinguishable from an ancient browser unless
 * asked separately, and "your browser doesn't support notifications" is the wrong
 * thing to tell someone one tap away from having them.
 */
function isUninstalledIos(): boolean {
    const ua = navigator.userAgent
    const isIos =
        /\biPhone\b|\biPad\b|\biPod\b/.test(ua) || (/\bMacintosh\b/.test(ua) && hasTouch())
    if (!isIos) {
        return false
    }
    return !window.matchMedia('(display-mode: standalone)').matches
}

function hasTouch(): boolean {
    return navigator.maxTouchPoints > 1
}

/**
 * base64url → the Uint8Array `pushManager.subscribe` wants for its key.
 *
 * Backed by an explicit ArrayBuffer: the default `Uint8Array` is generic over
 * ArrayBufferLike, which includes SharedArrayBuffer and so isn't a `BufferSource`.
 */
function decodeKey(base64Url: string): Uint8Array<ArrayBuffer> {
    const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
    const bytes = new Uint8Array(new ArrayBuffer(binary.length))
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}

async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The registration, or null if this page has none.
 *
 * Not a bare `navigator.serviceWorker.ready`: that promise never settles when
 * nothing is registered, which is the normal state under `vite dev` — the card
 * would sit on "Loading…" for ever with no indication why. `getRegistration()`
 * answers immediately, and `ready` is then only awaited when there is genuinely
 * one activating.
 */
async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
    const existing = await navigator.serviceWorker.getRegistration()
    if (existing == null) {
        return null
    }
    return navigator.serviceWorker.ready
}

async function fetchConfig(signal?: AbortSignal): Promise<Config> {
    const res = await fetch('/api/push/config', { signal })
    if (!res.ok) {
        throw new Error('failed')
    }
    return (await res.json()) as Config
}

/** Register this browser's subscription with the signed-in account. */
async function saveSubscription(subscription: PushSubscription, signal?: AbortSignal) {
    const payload = subscription.toJSON() as {
        endpoint?: string
        keys?: { p256dh?: string; auth?: string }
    }

    const res = await fetch('/api/push/subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
            endpoint: payload.endpoint,
            keys: payload.keys,
            label: describeBrowser(navigator.userAgent, { hasTouch: hasTouch() }),
        }),
    })
    if (!res.ok) {
        throw new Error('failed')
    }
}

export function usePush(): Push {
    const [status, setStatus] = useState<PushStatus>('loading')
    const [publicKey, setPublicKey] = useState<string | null>(null)
    const [preferences, setPreferencesState] = useState<NotificationPreferences>({
        sessionUploaded: true,
    })
    const [subscriptions, setSubscriptions] = useState<readonly PushSubscriptionRow[]>([])
    // The hash of this browser's endpoint, so its own row can be told from the
    // other devices' without the endpoint ever leaving the browser.
    const [ownHash, setOwnHash] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [reloadKey, setReloadKey] = useState(0)
    // Serialises preference writes — see setPreferences.
    const pending = useRef<Promise<unknown>>(Promise.resolve())

    useEffect(() => {
        const abort = new AbortController()

        async function load() {
            if (!isSupported()) {
                setStatus(isUninstalledIos() ? 'needs-install' : 'unsupported')
                return
            }

            // Started together: a cold service worker start would otherwise be
            // added to the config round trip rather than overlapped with it.
            const configPromise = fetch('/api/push/config', { signal: abort.signal })
            const registrationPromise = serviceWorkerRegistration()

            const res = await configPromise
            if (!res.ok) {
                throw new Error('failed')
            }
            const config = (await res.json()) as Config

            setPublicKey(config.publicKey)
            setPreferencesState(config.preferences)
            setSubscriptions(config.subscriptions)

            const registration = await registrationPromise
            if (registration == null) {
                // No service worker, so nothing can receive a push. Normal under
                // `vite dev`, where the PWA plugin registers none.
                setStatus('unsupported')
                return
            }

            const existing = await registration.pushManager.getSubscription()
            const hash = existing == null ? null : await sha256Hex(existing.endpoint)
            setOwnHash(hash)

            if (config.publicKey == null) {
                setStatus('unconfigured')
                return
            }
            if (Notification.permission === 'denied') {
                setStatus('blocked')
                return
            }

            if (existing == null) {
                setStatus('off')
                return
            }

            // A live local subscription is not proof the server still has a row
            // for it, or that the row belongs to *this* account. It survives
            // signing out, and it can be evicted by the per-account cap. Left
            // alone, the card would read "on" while this browser received either
            // nothing or — on a shared machine — the previous account's sessions.
            //
            // So re-send it. The PUT is idempotent by design precisely so that
            // this is safe to do on every load; it re-points the endpoint at
            // whoever is signed in now.
            if (!config.subscriptions.some((row) => row.endpointHash === hash)) {
                await saveSubscription(existing, abort.signal)
                setSubscriptions(await fetchConfig(abort.signal).then((c) => c.subscriptions))
            }
            setStatus('on')
        }

        load().catch(() => {
            if (!abort.signal.aborted) {
                setError("Couldn't load your notification settings — reload to try again.")
                setStatus('unsupported')
            }
        })

        return () => abort.abort()
    }, [reloadKey])

    const enable = useCallback(
        function enable() {
            setBusy(true)
            setError(null)

            async function run() {
                if (publicKey == null) {
                    return
                }

                const permission = await Notification.requestPermission()
                if (permission !== 'granted') {
                    // 'default' means the prompt was dismissed rather than
                    // refused — the toggle simply stays off and can be tried
                    // again; 'denied' cannot be re-prompted from here.
                    setStatus(permission === 'denied' ? 'blocked' : 'off')
                    return
                }

                const registration = await serviceWorkerRegistration()
                if (registration == null) {
                    setStatus('unsupported')
                    return
                }

                const subscription = await registration.pushManager.subscribe({
                    // Not optional, and false is not accepted: a push must
                    // result in a notification the user can see.
                    userVisibleOnly: true,
                    applicationServerKey: decodeKey(publicKey),
                })

                try {
                    await saveSubscription(subscription)
                } catch (cause) {
                    // Leaving the browser subscribed to a push service the server
                    // has no record of would mean a device that can never be
                    // turned off from the settings list.
                    await subscription.unsubscribe().catch(() => {})
                    throw cause
                }

                setReloadKey((key) => key + 1)
            }

            run()
                .catch(() => setError("Notifications couldn't be turned on — try again."))
                .finally(() => setBusy(false))
        },
        [publicKey],
    )

    const disable = useCallback(function disable() {
        setBusy(true)
        setError(null)

        async function run() {
            const registration = await serviceWorkerRegistration()
            const subscription = await registration?.pushManager.getSubscription()
            if (subscription == null) {
                return
            }

            const hash = await sha256Hex(subscription.endpoint)
            // Unsubscribe first: it is the half that actually stops the buzzing,
            // and it is the half that cannot be done from another device later.
            await subscription.unsubscribe()

            const row = await findRow(hash)
            if (row != null) {
                await fetch(`/api/push/subscriptions/${row.id}`, { method: 'DELETE' })
            }
            setReloadKey((key) => key + 1)
        }

        run()
            .catch(() => setError("Notifications couldn't be turned off — try again."))
            .finally(() => setBusy(false))
    }, [])

    async function findRow(hash: string): Promise<PushSubscriptionRow | null> {
        const config = await fetchConfig().catch(() => null)
        return config?.subscriptions.find((row) => row.endpointHash === hash) ?? null
    }

    const setPreferences = useCallback(function setPreferences(next: NotificationPreferences) {
        // Optimistic: a toggle that waits on a round trip before moving reads as
        // broken, and the only failure mode is that it snaps back.
        setPreferencesState(next)
        setError(null)

        // Chained rather than fired straight off. Two quick taps otherwise start
        // two independent PATCHes, and nothing makes them arrive in the order
        // they were sent — the first can land last and persist the value the user
        // just turned off, while the card goes on showing the second. Both
        // return 204, so nothing surfaces it.
        pending.current = pending.current
            .catch(() => {})
            .then(async () => {
                const res = await fetch('/api/push/preferences', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(next),
                })
                if (!res.ok) {
                    throw new Error('failed')
                }
            })
            .catch(() => {
                setError("That setting couldn't be saved — try again.")
                setReloadKey((key) => key + 1)
            })
    }, [])

    const forget = useCallback(function forget(id: string) {
        setBusy(true)
        setError(null)

        fetch(`/api/push/subscriptions/${id}`, { method: 'DELETE' })
            .then((res) => {
                if (!res.ok) {
                    throw new Error('failed')
                }
                setReloadKey((key) => key + 1)
            })
            .catch(() => setError("That device couldn't be turned off — try again."))
            .finally(() => setBusy(false))
    }, [])

    return {
        status,
        preferences,
        otherDevices: subscriptions.filter((row) => row.endpointHash !== ownHash),
        busy,
        error,
        enable,
        disable,
        setPreferences,
        forget,
    }
}
