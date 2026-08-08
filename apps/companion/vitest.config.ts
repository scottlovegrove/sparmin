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
                                // Every value the app reads is pinned here rather
                                // than left to .dev.vars, which is git-ignored and
                                // so absent in CI and different on every machine.
                                // None of these are real.
                                ENVIRONMENT: 'test',
                                BETTER_AUTH_URL: 'http://localhost:5173',
                                BETTER_AUTH_SECRET: 'test-only-secret-not-used-anywhere-real',
                                EMAIL_FROM: 'Sparmin <test@example.com>',
                                // Blank on purpose, and not negotiable: with a key
                                // the suite sends real mail to the addresses the
                                // tests invent, every run. Blank takes the branch
                                // that logs the link instead.
                                RESEND_API_KEY: '',
                                // A throwaway VAPID pair, generated for this file
                                // and used nowhere else. It has to be a real
                                // P-256 pair rather than a placeholder string:
                                // the send path imports it through WebCrypto, so
                                // anything else fails at importKey and every push
                                // test fails for the wrong reason. Without these
                                // three the push routes take their
                                // not-configured branch and most of the suite
                                // would silently assert nothing.
                                VAPID_SUBJECT: 'mailto:test@example.com',
                                VAPID_PUBLIC_KEY:
                                    'BDaeIk4jPeXhMGAqIE-mhJIET6ocg9rvvESnU_sOzLzUO72aQdMjxr2BGjIjsLsKJDjQm9QA0yhs6SICrI3NkYg',
                                VAPID_PRIVATE_KEY: 'XMZijkPX3IPYYqQNRVmRJgqJ6CNxeVkKH5ANxa1dNOc',
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
