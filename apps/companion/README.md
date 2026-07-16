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
npm run dev            # vite dev — SPA + Worker with HMR
npm run build          # vite build — client bundle + Worker
npm run preview        # preview the production build locally
npm run test           # vitest (workerd pool)
npm run check          # tsc -b + oxlint + oxfmt --check
npm run fix            # oxlint --fix + oxfmt
npm run cf-typegen     # regenerate worker-configuration.d.ts from wrangler.jsonc
npm run deploy         # wrangler deploy
```

Run any of these from `apps/companion/`, or from the repo root via the
`*:companion` convenience scripts.

## Auth

Magic link only, via better-auth. There are no passwords.

```bash
cp .dev.vars.example .dev.vars    # git-ignored; put local config + secrets here
```

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

**Before deploying:** set the secrets, which never live in the repo.

```bash
npx wrangler secret put BETTER_AUTH_SECRET   # openssl rand -hex 32
npx wrangler secret put RESEND_API_KEY
```

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

**Before the first remote deploy** the D1 database has to exist, and its id has to
go into `wrangler.jsonc` (`database_id`, currently the local placeholder):

```bash
npx wrangler d1 create sparmin-companion             # prints the database_id
npx wrangler d1 migrations apply DB --remote
```

**WSL2:** keep the repo on the Linux filesystem (`~/`), not `/mnt/c`.
