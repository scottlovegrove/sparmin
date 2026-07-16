import { applyD1Migrations, env } from 'cloudflare:test'

// Runs once per isolated test worker, before any test: brings the test D1 up to
// the current schema and seed, so tests exercise the real migrations rather than
// a hand-maintained fixture schema.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
