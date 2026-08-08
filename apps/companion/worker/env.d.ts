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
    // The VAPID identity push services check a notification against. Optional
    // together: with none of them set the app simply has no push, which is the
    // right state for a local checkout that has never generated a pair. The
    // public half is not a secret — it is handed to every browser that subscribes
    // — but it lives here beside the private one so the two can't drift apart
    // across environments.
    VAPID_PUBLIC_KEY?: string
    VAPID_PRIVATE_KEY?: string
}
