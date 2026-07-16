import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Migrations are read at config time and applied by test/apply-migrations.ts in a
// setup file, so every isolated test database starts fully migrated and seeded.
const migrations = await readD1Migrations('./migrations')

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
                plugins: [
                    cloudflareTest({
                        wrangler: { configPath: './wrangler.jsonc' },
                        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
                    }),
                ],
                test: {
                    name: 'worker',
                    include: ['test/**/*.test.ts'],
                    setupFiles: ['./test/apply-migrations.ts'],
                },
            },
        ],
    },
})
