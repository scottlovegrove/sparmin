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

## Database (D1 + Drizzle)

The D1 binding and migrations land with the schema work. The workflow will be:

```bash
npm run db:generate                                   # drizzle-kit generate → ./migrations
npx wrangler d1 migrations apply DB --local           # apply locally
npx wrangler d1 migrations apply DB --remote          # apply to production
```

Always apply migrations with `wrangler`, never `drizzle-kit migrate`. Local D1 is
a real SQLite file under `.wrangler/state/` — open it with any SQLite client.

**WSL2:** keep the repo on the Linux filesystem (`~/`), not `/mnt/c`.
