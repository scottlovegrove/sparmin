import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NAVIGATE_FALLBACK_DENYLIST, webManifest, workboxOptions } from '../pwa.config'

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

describe('workbox options', () => {
    it('keeps the crawler-only social card and the FIT parser out of the precache', () => {
        expect(workboxOptions.globIgnores).toContain('**/images/og-default.png')
        expect(workboxOptions.globIgnores).toContain('**/assets/parse-fit-*.js')
    })

    it('does not glob the manifest, which the plugin precaches itself', () => {
        // Globbing it too puts it in the precache list twice.
        for (const pattern of workboxOptions.globPatterns) {
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
        expect(workboxOptions).not.toHaveProperty('runtimeCaching')
    })
})
