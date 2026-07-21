# Sparmin Companion

Thermal spa session logger: a React + Vite SPA served by a Hono Cloudflare Worker
with a D1 (SQLite) backend. FIT files exported from the watch are parsed
client-side and posted to the Worker's API. See
[`docs/spa-logger-spec.md`](../../docs/spa-logger-spec.md) for the full spec and
the PR plan.

One deployable unit: the Worker serves the built SPA as static assets **and**
handles `/api/*`, so client and API are same-origin (no CORS).

## Layout

```
src/        React SPA (client). FIT parsing runs here.
  db/       Drizzle schema for D1.
worker/     Hono Worker: /api/* routes, serves the SPA assets.
test/       Vitest tests, run in workerd via @cloudflare/vitest-pool-workers.
```

## Commands

```bash
npm run dev            # vite dev — SPA + Worker with HMR (applies local migrations first)
npm run build          # vite build — client bundle + Worker
npm run preview        # preview the production build locally
npm run test           # vitest (workerd pool)
npm run db:migrate     # apply pending migrations to the local D1
npm run check          # tsc -b + oxlint + oxfmt --check
npm run fix            # oxlint --fix + oxfmt
npm run cf-typegen     # regenerate worker-configuration.d.ts from wrangler.jsonc
```

A fresh clone has an empty local D1, so `dev` runs `db:migrate` first (via
`predev`) — otherwise the first sign-in fails with `no such table`. It's
idempotent: once the schema is current it's a no-op.

Run any of these from `apps/companion/`, or from the repo root via the
`*:companion` convenience scripts.

There is no deploy script: deploys come from CI, off main (see below).

## Auth

Magic link **or passkey**, via better-auth. There are no passwords. Magic link is
the way in on a new device; once signed in, a user can register a passkey from the
settings screen and use it to sign in thereafter.

```bash
cp .dev.vars.example .dev.vars    # git-ignored; put local config + secrets here
```

### Dev secrets (SOPS)

A working `.dev.vars` is shared, encrypted, as `.dev.vars.sops` (committed) using
[SOPS](https://getsops.io/) with an `age` backend — the same key pair as
`~/shiftsync`, so if `SOPS_AGE_KEY` is already in your shell it Just Works. Only
values are encrypted; keys and comments stay readable in `git diff`. From the repo
root:

```bash
npm run secrets:decrypt -w @sparmin/companion   # .dev.vars.sops → .dev.vars (git-ignored)
npm run secrets:view    -w @sparmin/companion   # print the plaintext without writing it
npm run secrets:edit    -w @sparmin/companion   # edit values in-place, re-encrypts on save
```

To change a shared value: `secrets:edit` (or edit `.dev.vars` then
`secrets:encrypt`), then commit the updated `.dev.vars.sops`. Without the key,
fall back to `cp .dev.vars.example .dev.vars` above — everything but
`BETTER_AUTH_SECRET` is non-sensitive, and that can be any random string for dev.
The config and public recipient live in `.sops.yaml`.

Passkeys use the `@better-auth/passkey` plugin (pinned to the same version as
better-auth). It adds one `passkey` table and its own `/api/auth/passkey/*`
endpoints, and mints the same session cookie a magic link does. The relying-party
id (`rpID`) and `origin` are derived from `BETTER_AUTH_URL` — no extra secret or
var. WebAuthn needs a secure context: the production domain already has a
certificate, and `localhost` counts as secure so dev works over plain http.

**No email provider is needed to work on the app.** Without `RESEND_API_KEY`, the
magic link prints to the wrangler console — sign in by opening the link it logs.
In production a missing key is an error rather than a fallback, so a live link can
never end up in the logs.

`worker/auth.ts` builds the auth instance per request, because bindings don't
exist at module scope on Workers. `better-auth.config.ts` exists only for
`@better-auth/cli generate` — keep its plugin list in step with `auth.ts`, or the
generated schema stops matching what runs:

```bash
npx @better-auth/cli generate --config ./better-auth.config.ts --output ./src/db/auth-schema.ts
npm run db:generate    # then a migration for the change
```

Everything under `/api` needs a session except `/api/health` and `/api/auth/*` —
the guard is registered before the routes, so anything added later is closed
unless it's deliberately opened.

Secrets are declared by hand in `worker/env.d.ts`, not picked up by
`cf-typegen` — it can only see them if they're in your local `.dev.vars`, which
would make the committed types depend on a file that isn't in the repo and drop
them in CI. The committed `worker-configuration.d.ts` is the one generated
**without** `.dev.vars`; regenerating with it present adds a harmless duplicate
line that isn't worth committing.

**Before deploying:** set the secrets, which never live in the repo. Wrangler
prompts for the value, so it stays out of your shell history.

```bash
npm run secret BETTER_AUTH_SECRET   # a fresh one: openssl rand -hex 32
npm run secret RESEND_API_KEY
npm run secrets                     # lists the names, never the values
```

From the repo root these are `secret:companion` / `secrets:companion` — wrangler
needs this workspace's `wrangler.jsonc`, so bare `wrangler secret put` from the
root fails with "Required Worker name missing".

## Database (D1 + Drizzle)

The schema lives in `src/db/schema.ts`; migrations are generated from it into
`./migrations` and applied with wrangler:

```bash
npm run db:generate                                   # drizzle-kit generate → ./migrations
npx wrangler d1 migrations apply DB --local           # apply locally
npx wrangler d1 migrations apply DB --remote          # apply to production
```

Always apply migrations with `wrangler`, never `drizzle-kit migrate` (it wants
d1-http credentials and targets production).

**Drizzle only numbers its own migrations.** Hand-written ones (the station seed)
are invisible to its journal, so a generated migration can collide with them — if
it does, renumber the new file and bump its `idx`/`tag` in `migrations/meta/_journal.json`
to match. Read what it generates, too: its SQLite table-rebuild path mangles the
`desc` index in `idx_sessions_user_time`, which `0002` fixes by hand. Local D1 is a real SQLite file under
`.wrangler/state/` — open it with any SQLite client. Tests don't need any of this:
the vitest pool reads `./migrations` and applies them to each isolated test
database automatically (`test/apply-migrations.ts`).

`stations` is seeded by migration from the watch's catalogue
(`apps/watch/source/SpaActivity.mc`) — those names are the raw values the watch
writes into each FIT lap, so they are the join key and must match exactly.

The production database already exists (`sparmin-companion`, WEUR) and its id is
in `wrangler.jsonc`. That id names the database; it isn't a credential, so it
belongs in the config like any other binding. Deploys apply migrations for you —
the `--remote` command above is for when you want to do it by hand.

**WSL2:** keep the repo on the Linux filesystem (`~/`), not `/mnt/c`.

## Deploying

Pushing to `main` deploys, via `.github/workflows/deploy-companion.yml`, to
<https://sparmin-app.scottlovegrove.co.uk>. Nothing else does — there is no manual
trigger and no deploy script, so what is live is always a commit on main that
passed the checks. The workflow re-runs `integrity-check` rather than assuming a
PR gated it, since main takes direct pushes; then applies migrations, then
deploys, in that order, so the new code never meets the old schema.

(Removing the script is a signpost, not a lock: anyone with credentials can still
run `wrangler deploy` by hand. The point is that the repo has one obvious path.)

`workers_dev` is off deliberately: a `*.workers.dev` address would serve the same
app from an origin the session cookie and `BETTER_AUTH_URL` know nothing about.
One hostname, one origin.

**The hostname is one label deep, and has to stay that way.** A Workers custom
domain is served by the zone's edge certificate, and the free Universal one covers
`scottlovegrove.co.uk` and `*.scottlovegrove.co.uk` — a wildcard matches one label
and doesn't cascade. `app.sparmin.scottlovegrove.co.uk` was tried and can't work:
DNS resolves, the Worker sits behind it, and every request dies on the TLS
handshake with no certificate (`ERR_SSL_VERSION_OR_CIPHER_MISMATCH`). Nothing about
that resolves with time. Covering a deeper name needs Total TLS → Advanced
Certificate Manager → a paid add-on. Hence the hyphen.

### What CI needs

A `CLOUDFLARE_API_TOKEN` repository secret — a local `wrangler login` is a
personal OAuth token and is no use from Actions. Create it at
[Cloudflare → API Tokens](https://dash.cloudflare.com/profile/api-tokens),
starting from the **Edit Cloudflare Workers** template, which needs adding to:

| Scope               | Why                                         |
| ------------------- | ------------------------------------------- |
| Account → D1 → Edit | applying migrations                         |
| Zone → DNS → Edit   | the custom domain's record, on first deploy |

Restrict it to this account and the `scottlovegrove.co.uk` zone. The `production`
environment in the workflow is where it should live, rather than as a plain
repository secret: it means only a run targeting that environment can read it,
and it gives somewhere to require an approval later if that ever seems worth it.
