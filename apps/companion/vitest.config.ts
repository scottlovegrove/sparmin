import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Tests run inside workerd via @cloudflare/vitest-pool-workers, with the real
// bindings from wrangler.jsonc and isolated per-test storage.
export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
        }),
    ],
})
