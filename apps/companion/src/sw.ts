/// <reference lib="webworker" />
import {
    type PrecacheEntry,
    cleanupOutdatedCaches,
    createHandlerBoundToURL,
    precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NAVIGATE_FALLBACK_DENYLIST } from '../pwa.config'
import { parsePushPayload } from './lib/push-payload'

// The service worker is hand-written rather than generated because a `push`
// handler has to live somewhere and `generateSW` offers no seam for one. Everything
// above the push listener is a faithful port of what workbox was emitting — same
// calls, same order — so the shell, the update prompt and the magic-link denylist
// behave exactly as they did before. Diff it against a build's sw.js before
// changing any of it.
//
// `let` rather than `const`: lib.webworker already declares `self`, and this
// narrows it rather than introducing a second binding.
declare let self: ServiceWorkerGlobalScope & {
    readonly __WB_MANIFEST: readonly (PrecacheEntry | string)[]
}

// The prompt half of `registerType: 'prompt'`. workbox-window's
// `messageSkipWaiting()` posts this when the update banner's Update button reaches
// `updateServiceWorker(true)` in use-app-update.ts; without the listener the
// waiting worker never activates and the button reads as broken.
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting()
    }
})

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Nothing calls `clients.claim()`, deliberately: a page that installed the worker
// on this very load stays uncontrolled, which is the case use-app-update.ts's
// three-second reload fallback exists to cover. Claiming here would change that
// contract silently.
registerRoute(
    new NavigationRoute(createHandlerBoundToURL('index.html'), {
        denylist: NAVIGATE_FALLBACK_DENYLIST,
    }),
)

// A session arrived from the user's watch while the app was closed. The payload is
// built by worker/push.ts and travels encrypted; parsePushPayload is deliberately
// forgiving, because the worker that receives a message can be weeks older than
// the Worker that sent it.
self.addEventListener('push', (event) => {
    const payload = parsePushPayload(event.data?.text() ?? '')
    if (payload == null) {
        // Some browsers show a generic "This site has been updated in the
        // background" notice if a push event resolves without showing anything.
        // There is nothing useful to say, so say the least misleading thing.
        return
    }

    event.waitUntil(
        self.registration.showNotification(payload.title, {
            body: payload.body,
            icon: '/pwa-192x192.png',
            badge: '/pwa-64x64.png',
            // Replaces rather than stacks, so a push service's retry leaves one
            // notification rather than two of the same session.
            tag: payload.tag,
            data: { url: payload.url },
        }),
    )
})

self.addEventListener('notificationclick', (event) => {
    event.notification.close()

    const url = (event.notification.data as { url?: string } | null)?.url ?? '/'
    event.waitUntil(focusOrOpen(url))
})

/**
 * Bring the app forward rather than opening a second copy of it.
 *
 * `includeUncontrolled` matters: nothing here claims clients, so a tab opened
 * before this worker activated is not controlled by it and would otherwise be
 * invisible — the user would tap the notification and get a duplicate window
 * alongside the app they already had open.
 */
async function focusOrOpen(url: string): Promise<void> {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

    for (const client of clients) {
        if ('focus' in client) {
            await client.focus()
            return
        }
    }

    await self.clients.openWindow(url)
}
