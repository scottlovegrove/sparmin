import type { ManifestOptions } from 'vite-plugin-pwa'

// Plain data, no vite imports — src/pwa-config.test.ts asserts against it, and that
// test runs in the node project where pulling in the build tooling would be slow and
// pointless. Keep it that way.

/**
 * Navigations that must reach the network, never the precached SPA shell.
 *
 * Everything under `/api` belongs to the Worker — `wrangler.jsonc` says as much with
 * `run_worker_first: ["/api/*"]`. Most of it is fetched with `fetch`, which workbox's
 * navigation route ignores, so it would be tempting to think none of this matters.
 * It does: better-auth's magic link is a top-level **navigation** to
 * `/api/auth/magic-link/verify?token=…`. Without this the service worker answers it
 * from the precache with index.html, the Worker never sees the token, no cookie is
 * set, and the user lands back on the sign-in screen having done everything right.
 *
 * That failure is invisible in the ways that matter: no error anywhere, only for
 * people who installed the app, and never in a fresh incognito window.
 *
 * One regex, matching the boundary wrangler.jsonc already draws. Enumerating the
 * individual auth paths would be a second copy of the routing table, and it would
 * drift. Note workbox tests these against `pathname + search`, so anchoring the end
 * would stop the token-bearing URL matching.
 */
export const NAVIGATE_FALLBACK_DENYLIST = [/^\/api\//]

export const webManifest: Partial<ManifestOptions> = {
    // Pinned rather than left to default to start_url, so changing start_url later
    // can't orphan every existing install.
    id: '/',
    name: 'Sparmin',
    short_name: 'Sparmin',
    description: 'Your thermal spa sessions, from your watch.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // The app is one narrow column. It survives landscape, but nothing is designed
    // for it — and locking someone's rotation is worse than a wide column.
    orientation: 'any',
    // The splash behind the icon while the app boots. Matches the plate the icons are
    // drawn on, so the icon reads as part of the splash rather than a sticker on it.
    background_color: '#101418',
    // The brand colour, matching the light-scheme theme-color in index.html. Once the
    // document loads, the two media-scoped metas take over and this governs only the
    // pre-load chrome.
    theme_color: '#0b6b6b',
    lang: 'en-GB',
    dir: 'ltr',
    categories: ['health', 'fitness', 'lifestyle'],
    icons: [
        { src: '/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        {
            // Its own entry rather than `purpose: 'any maskable'`: a mark padded for
            // the safe zone looks shrunken used as a plain icon, and one declared
            // both ways gets used both ways.
            src: '/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
        },
    ],
    // There are only two routes, and `/` is the import screen you land on anyway, so
    // this is the only shortcut with anything to say.
    shortcuts: [
        {
            name: 'Settings',
            short_name: 'Settings',
            description: 'Passkeys, linked watches and account',
            url: '/settings',
            icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }],
        },
    ],
}

export const workboxOptions = {
    // No `webmanifest` here on purpose: vite-plugin-pwa adds the manifest to the
    // precache itself, and globbing it too lists it twice.
    globPatterns: ['**/*.{js,css,html,svg,png}'],
    globIgnores: [
        // Only ever fetched by link-preview crawlers. 137 KB the app never renders,
        // in every install's precache for nothing.
        '**/images/og-default.png',
        // The Garmin FIT SDK, deliberately split into its own lazy chunk (see
        // src/lib/import-fit.ts) and most of this app's JavaScript. Offline scope is
        // the app shell — there is no offline import — so precaching the parser buys
        // a slower install and nothing else. It is content-hashed and immutable at
        // the edge, so the first import still fetches it once and keeps it.
        '**/assets/parse-fit-*.js',
    ],
    navigateFallbackDenylist: NAVIGATE_FALLBACK_DENYLIST,
}
