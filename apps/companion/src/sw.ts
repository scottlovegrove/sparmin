/// <reference lib="webworker" />
import {
    type PrecacheEntry,
    cleanupOutdatedCaches,
    createHandlerBoundToURL,
    precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NAVIGATE_FALLBACK_DENYLIST } from '../pwa.config'

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
