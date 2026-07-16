import { readFileSync } from 'node:fs'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Migrations are read at config time and applied by test/apply-migrations.ts in a
// setup file, so every isolated test database starts fully migrated and seeded.
const migrations = await readD1Migrations('./migrations')

// Worker tests run in workerd, where the filesystem isn't the repo's — so the FIT
// fixture the end-to-end ingest test needs is read here, in node, and passed
// through as a binding. Vite's asset handling is no use: it hands back a URL
// string, and there is no server to fetch it from.
const INGEST_FIXTURE = 'test/fixtures/23520138132_ACTIVITY.fit'
const fixtureBytes = [...readFileSync(INGEST_FIXTURE)]

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
                        miniflare: {
                            bindings: {
                                TEST_MIGRATIONS: migrations,
                                TEST_FIT_FIXTURE: fixtureBytes,
                                // Auth config is pinned here rather than left to
                                // .dev.vars, which is git-ignored and so absent in
                                // CI. Tests should not depend on a developer's
                                // local secrets file. None of these are real.
                                ENVIRONMENT: 'test',
                                BETTER_AUTH_URL: 'http://localhost:5173',
                                BETTER_AUTH_SECRET: 'test-only-secret-not-used-anywhere-real',
                                EMAIL_FROM: 'Sparmin <test@example.com>',
                            },
                        },
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
