import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { type Plugin, defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { injectManifestOptions, webManifest } from './pwa.config'

// The Cloudflare plugin makes this a two-environment build: `client` (the SPA, into
// dist/client, which is the directory the Worker's `assets` binding serves) and
// `sparmin_companion` (the Worker, into dist/sparmin_companion). vite-plugin-pwa
// knows nothing about environments — it reads the top-level `outDir` and registers
// its build hooks everywhere — so both lines below are load-bearing. Without them:
// sw.js lands in dist/, outside the served directory, and is never uploaded; the
// precache manifest lists dist/sparmin_companion/index.js as a URL to fetch, which
// 404s and aborts the whole install; and manifest.webmanifest is emitted into the
// Worker bundle. All three fail silently — the app just quietly isn't a PWA.
const pwa: Plugin[] = VitePWA({
    outDir: 'dist/client',
    injectRegister: 'auto',
    // Not 'autoUpdate': a waiting worker surfaces `needRefresh` so the in-app banner
    // can offer an explicit Update rather than reloading under someone mid-import.
    // `skipWaiting` is deliberately absent — the new worker waits until
    // updateServiceWorker(true) is called from that banner.
    registerType: 'prompt',
    // The icons all live in public/ and are already swept up by the `**/*.png` glob,
    // so letting the plugin add the manifest's icons too just lists each of them
    // twice. Workbox dedupes identical revisions rather than complaining, which is
    // exactly why this would otherwise go unnoticed.
    includeManifestIcons: false,
    // The worker is ours, in src/sw.ts, rather than one workbox writes: a `push`
    // handler has to live somewhere and `generateSW` has no seam for one. The
    // plugin builds that file in a nested Vite build of its own — `configFile:
    // false`, none of the plugins above — so the Cloudflare plugin's environments
    // don't reach it, and `outDir` below is what puts sw.js beside the app.
    strategies: 'injectManifest',
    srcDir: 'src',
    filename: 'sw.ts',
    manifest: webManifest,
    injectManifest: injectManifestOptions,
}).map((plugin) => ({
    ...plugin,
    applyToEnvironment: (environment) => environment.name === 'client',
}))

// One Vite build produces both the client bundle and the Worker; the Cloudflare
// plugin reads wrangler.jsonc and wires the `assets` output to the Worker.
export default defineConfig({
    define: {
        // The build number, from CI (see .github/workflows/deploy-companion.yml),
        // which derives it from the `companion-v<N>` git tags. A local or PR build
        // has no tag behind it and is honestly labelled 'dev'.
        //
        // A bare define rather than `import.meta.env.VITE_*`: the latter is only
        // materialised for bundled environments, which excludes the Worker under
        // `vite dev`, and `tsconfig.worker.json` types the Worker with
        // @cloudflare/workers-types, where `import.meta.env` doesn't exist. This
        // reaches both environments — the Cloudflare plugin's per-environment
        // define merges with the top-level one rather than replacing it.
        __APP_VERSION__: JSON.stringify(process.env.COMPANION_BUILD ?? 'dev'),
    },
    plugins: [react(), cloudflare(), ...pwa],
    server: {
        // The port is part of the app's identity in development: BETTER_AUTH_URL
        // names it, and better-auth refuses any other origin. Vite's habit of
        // quietly moving to the next free port turns "something else has 5173"
        // into "Invalid origin: http://localhost:5174", which says nothing about
        // the actual problem. Fail on the port instead.
        port: 5173,
        strictPort: true,
    },
})
