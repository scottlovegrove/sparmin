/// <reference types="@cloudflare/vitest-pool-workers/types" />

// `cloudflare:test`'s `env` is typed as `Cloudflare.Env`, generated from
// wrangler.jsonc by `npm run cf-typegen`. TEST_MIGRATIONS is injected by
// vitest.config.ts for the migration setup file — not a real binding, so it is
// merged in here rather than declared in wrangler.jsonc.
declare namespace Cloudflare {
    interface Env {
        TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
    }
}
