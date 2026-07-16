// Secrets are set with `wrangler secret put`, so they aren't in wrangler.jsonc.
// `wrangler types` only sees them if they happen to be in the local, git-ignored
// .dev.vars — which would make the generated types depend on a file that isn't in
// the repo, and drop these on a fresh checkout or in CI.
//
// Declared here instead, so they hold whether or not a developer has .dev.vars.
// They merge into `__BaseEnv_Env` rather than `Env`, because the generated file
// derives both the global `Env` and `Cloudflare.Env` (what `cloudflare:test`'s
// `env` is typed as) from that one base.
interface __BaseEnv_Env {
    BETTER_AUTH_SECRET: string
    // Optional on purpose: without it the magic link prints to the console, so the
    // app runs with no email provider. In production its absence is an error, not
    // a fallback (see email.ts).
    RESEND_API_KEY?: string
}
