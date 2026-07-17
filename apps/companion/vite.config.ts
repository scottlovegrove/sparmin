import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// One Vite build produces both the client bundle and the Worker; the Cloudflare
// plugin reads wrangler.jsonc and wires the `assets` output to the Worker.
export default defineConfig({
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
