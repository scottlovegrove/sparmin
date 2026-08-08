// Replaced at build time by the `define` in vite.config.ts. Declared here, at the
// workspace root, rather than in src/vite-env.d.ts because the Worker reads it too
// and the two live in separate tsconfig projects — tsconfig.app.json and
// tsconfig.worker.json both include this file.
//
// Optional, because a `define` is a textual substitution at build time and nothing
// substitutes it under vitest: the worker project's defines come from wrangler's
// config, not Vite's, so there is no way to supply it there without putting a
// second, stale copy of the value in wrangler.jsonc. src/lib/app-version.ts guards
// for that, and the deploy workflow asserts the real value after publishing.
declare const __APP_VERSION__: string | undefined
