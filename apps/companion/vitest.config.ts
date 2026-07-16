import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Two projects: pure client/parser units run in node (they read FIT fixtures off
// disk); worker/integration tests run inside workerd via
// @cloudflare/vitest-pool-workers with the real wrangler.jsonc bindings.
export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: 'unit',
                    environment: 'node',
                    include: ['src/**/*.test.ts'],
                },
            },
            {
                plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
                test: {
                    name: 'worker',
                    include: ['test/**/*.test.ts'],
                },
            },
        ],
    },
})
