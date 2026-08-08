import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
    plugins: [react(), cloudflare()],
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
