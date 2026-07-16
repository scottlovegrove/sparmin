import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// One Vite build produces both the client bundle and the Worker; the Cloudflare
// plugin reads wrangler.jsonc and wires the `assets` output to the Worker.
export default defineConfig({
    plugins: [react(), cloudflare()],
})
