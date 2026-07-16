// Secrets are set with `wrangler secret put`, so they aren't in wrangler.jsonc
// and `wrangler types` can't see them. Declared here instead, merged into the
// generated Env.
//
// RESEND_API_KEY is optional on purpose: without it, development prints the magic
// link to the console rather than emailing it, so the app runs with no email
// provider at all. In production its absence is an error, not a fallback.
interface Env {
    RESEND_API_KEY?: string
}
