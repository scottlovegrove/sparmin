import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NAVIGATE_FALLBACK_DENYLIST, injectManifestOptions, webManifest } from '../pwa.config'

// Nothing else checks any of this: the manifest is data handed to a build plugin, and
// the denylist only ever runs inside a service worker. Both are pinned here.

function isDenied(pathAndSearch: string) {
    return NAVIGATE_FALLBACK_DENYLIST.some((pattern) => pattern.test(pathAndSearch))
}

describe('navigation fallback denylist', () => {
    it('keeps the magic-link verification on the network', () => {
        // The one that matters. Workbox matches pathname + search, so the token has
        // to be part of the string being tested — a pattern anchored at the end
        // would pass a bare-path test and still break sign-in in production.
        expect(isDenied('/api/auth/magic-link/verify?token=abc123&callbackURL=%2F')).toBe(true)
    })

    it('denies every API path, not only the auth ones', () => {
        expect(isDenied('/api/health')).toBe(true)
        expect(isDenied('/api/sessions/123')).toBe(true)
        expect(isDenied('/api/auth/passkey/generate-authenticate-options')).toBe(true)
    })

    it('still serves the shell for the client routes', () => {
        expect(isDenied('/')).toBe(false)
        expect(isDenied('/settings')).toBe(false)
    })
})

describe('web manifest', () => {
    it('declares a stable identity', () => {
        expect(webManifest.id).toBe('/')
        expect(webManifest.start_url).toBe('/')
        expect(webManifest.scope).toBe('/')
        expect(webManifest.name).toBe('Sparmin')
        expect(webManifest.short_name).toBe('Sparmin')
    })

    it('installs standalone, with colours that match index.html and the icon plate', () => {
        expect(webManifest.display).toBe('standalone')
        expect(webManifest.theme_color).toBe('#0b6b6b')
        expect(webManifest.background_color).toBe('#101418')
    })

    it('offers the icon sizes an installer looks for, and exactly one maskable', () => {
        const icons = webManifest.icons ?? []
        const any = icons.filter((icon) => icon.purpose == null)
        const maskable = icons.filter((icon) => icon.purpose === 'maskable')

        expect(any.map((icon) => icon.sizes)).toContain('192x192')
        expect(any.map((icon) => icon.sizes)).toContain('512x512')
        // One entry, not `any maskable` on a shared one — a mark padded for the safe
        // zone looks shrunken when used as a plain icon.
        expect(maskable).toHaveLength(1)
    })

    it('points at icons by absolute path, and they exist', () => {
        // Relative srcs resolve against the manifest's own URL, which is fine today
        // and stops being fine the moment the manifest moves. The existsSync half
        // catches a rename that the generator config and this list disagree about.
        for (const icon of webManifest.icons ?? []) {
            expect(icon.src.startsWith('/')).toBe(true)
            expect(existsSync(`public${icon.src}`)).toBe(true)
        }
    })
})

describe('service worker source', () => {
    // Under generateSW the denylist was config the plugin read, and the assertions
    // above were enough. It is now a line of code in src/sw.ts, so nothing stops
    // that line being deleted — the build still succeeds, the suite still passes,
    // and magic-link sign-in breaks for installed users only. Hence reading the
    // source: crude, but it is the only thing standing between here and that.
    //
    // Comments are stripped first, and not for tidiness — sw.ts explains in prose
    // why it does not claim clients, and the un-stripped source therefore contains
    // the very string the last case asserts is absent. The positive cases have the
    // same hazard in reverse: a comment naming SKIP_WAITING would satisfy one with
    // the listener deleted.
    const source = readFileSync('src/sw.ts', 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')

    it('registers the navigation fallback with the denylist', () => {
        expect(source).toContain('NAVIGATE_FALLBACK_DENYLIST')
        expect(source).toContain('createHandlerBoundToURL')
        expect(source).toMatch(/denylist:\s*NAVIGATE_FALLBACK_DENYLIST/)
    })

    it('answers SKIP_WAITING, or the update banner has no effect', () => {
        // workbox-window posts this from updateServiceWorker(true). generateSW
        // emitted the listener for us; now we own it.
        expect(source).toContain('SKIP_WAITING')
        expect(source).toContain('self.skipWaiting()')
    })

    it('precaches the injected manifest', () => {
        expect(source).toContain('precacheAndRoute(self.__WB_MANIFEST)')
        expect(source).toContain('cleanupOutdatedCaches()')
    })

    it('shows a notification when a push arrives', () => {
        // Nothing else covers the receive side: the delivery tests stop at a
        // mocked fetch and the payload tests only parse JSON, so a deleted
        // listener leaves the whole suite green while users get nothing.
        expect(source).toMatch(/addEventListener\(\s*'push'/)
        expect(source).toContain('parsePushPayload')
        // A push handler that resolves without showing anything makes some
        // browsers substitute their own "site updated in the background" notice.
        expect(source).toMatch(/waitUntil\(\s*self\.registration\.showNotification\(/)
    })

    it('brings the app forward when a notification is clicked', () => {
        expect(source).toMatch(/addEventListener\(\s*'notificationclick'/)
        expect(source).toContain('event.notification.close()')
        // Nothing claims clients, so a tab opened before this worker activated is
        // uncontrolled — without this the user gets a second window alongside the
        // app they already had open.
        expect(source).toContain('includeUncontrolled: true')
        expect(source).toContain('openWindow')
    })

    it('does not claim clients', () => {
        // use-app-update.ts reloads on a timer precisely because the page stays
        // uncontrolled on first load. Claiming here would make that reload race
        // a controllerchange that now does fire.
        expect(source).not.toContain('clients.claim')
    })
})

describe('inject manifest options', () => {
    it('keeps the crawler-only social card and the FIT parser out of the precache', () => {
        expect(injectManifestOptions.globIgnores).toContain('**/images/og-default.png')
        expect(injectManifestOptions.globIgnores).toContain('**/assets/parse-fit-*.js')
    })

    it('builds the worker as a classic script', () => {
        // vite-plugin-pwa defaults this nested build to ES output, and the
        // register script loads sw.js with `type: 'classic'`. A surviving
        // top-level import or export is not a degraded cache — registration
        // fails outright and the app silently stops being a PWA.
        expect(injectManifestOptions.rollupFormat).toBe('iife')
    })

    it('does not glob the manifest, which the plugin precaches itself', () => {
        // Globbing it too puts it in the precache list twice.
        for (const pattern of injectManifestOptions.globPatterns) {
            expect(pattern).not.toContain('webmanifest')
        }
    })

    it('caches nothing at runtime, so no /api response is ever stored', () => {
        // The offline scope is the app shell. Every /api response is per-user and
        // sits behind a session cookie, so caching one would mean owning its
        // invalidation on sign-out and on account delete. Nothing above constrains
        // this — precache globs say nothing about runtime rules — so a
        // `runtimeCaching` entry for /api could be added tomorrow with the suite
        // still green. This is the assertion that stops that.
        //
        // If runtime caching is ever genuinely wanted, this test should be changed
        // to require a NetworkOnly rule for ^/api/ as the first entry, not deleted.
        expect(injectManifestOptions).not.toHaveProperty('runtimeCaching')
    })
})
