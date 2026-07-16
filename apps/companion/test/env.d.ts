/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module 'cloudflare:test' {
    // The pool exposes the same bindings as wrangler.jsonc; `Env` is generated
    // by `npm run cf-typegen`. Tests that use bindings read them from here.
    interface ProvidedEnv extends Env {}
}
