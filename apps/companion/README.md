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

## Link previews

`index.html` carries the `og:*` and `twitter:*` tags, with the card at
`public/images/og-default.png` (1200×630, committed rather than generated).
`src/index-html.test.ts` pins them. Two constraints worth knowing before editing
them: the URLs must stay absolute, because a relative `og:image` is dropped by
every crawler, and the tags must stay above the module script, because
WhatsApp's crawler reads only the first few kilobytes.

The shell is the single document served for every route, so the tags describe
the product, not the current view. Per-link previews (an invite naming the
sender, say) would need the Worker to render tags per path — and shouldn't carry
anything behind the sign-in regardless: an unfurl is fetched and cached by the
messaging platform's servers, not the recipient's device.

## Installable app (PWA)

The companion installs to a home screen: `vite-plugin-pwa` generates a web manifest
and a Workbox service worker that precaches the app shell. The manifest and the
Workbox options live as plain data in `pwa.config.ts`, so `src/pwa-config.test.ts`
can assert them without loading the build tooling.

**What is cached is the shell, and only the shell.** No `/api` response is ever
cached, there is no `runtimeCaching`, and there is no offline queue — the app is
installable and launches instantly, but everything it shows still comes from the
network. Two things are kept out of the precache deliberately: `og-default.png`,
which only link-preview crawlers ever fetch, and the lazily-loaded Garmin FIT parser
chunk, which is most of the app's JavaScript and is no use without a server to post
to.

### Two things that will break it

**`outDir` and `applyToEnvironment` in `vite.config.ts` are load-bearing.** The
Cloudflare plugin makes this a two-environment build — `dist/client` for the SPA,
which is the directory the Worker's `assets` binding serves, and
`dist/sparmin_companion` for the Worker. `vite-plugin-pwa` knows nothing about
environments: it reads the top-level `outDir` and registers its build hooks in every
environment. Left alone it writes `sw.js` to `dist/`, outside the served directory,
where it is never uploaded; lists `dist/sparmin_companion/index.js` in the precache
manifest as a URL to fetch, which 404s and aborts the whole install; and emits
`manifest.webmanifest` into the Worker bundle. All three fail silently — the app
looks fine and simply isn't a PWA.

**Every navigation under `/api/` must stay on `NAVIGATE_FALLBACK_DENYLIST`.** The
service worker answers navigations from the precached `index.html`. Almost all `/api`
traffic is `fetch`, which the navigation route ignores — but the magic-link sign-in
is a top-level navigation to `/api/auth/magic-link/verify?token=…`. Without the
denylist the service worker answers it with the SPA shell, the Worker never sees the
token, no cookie is set, and the user lands back on the sign-in screen having done
nothing wrong. There is no error anywhere, it only affects people who installed the
app, and it never reproduces in a fresh incognito window.

### Icons

Five PNGs in `public/`, generated from `public/favicon.svg` and committed:

```bash
npm run pwa-assets     # by hand, not part of the build
```

The generator is **not** a dependency of this workspace — the script fetches it with
`npx`. It brings its own copy of sharp and libvips, a stack of platform binaries that
every `npm ci` in the monorepo would otherwise install in order to regenerate five
files from art that never changes. (Sharp is already here via Astro and miniflare;
keeping the generator out avoids a second, nested copy.)

That is also why `pwa-assets.config.ts` imports nothing. Under `npx` the generator
lives in a cache directory that is not on the config's resolution path, so importing
`@vite-pwa/assets-generator/config` from it fails outright. The preset values are
inlined instead, and regenerating reproduces the committed PNGs byte for byte.

**The plate is `#101418`, and must not be white.** The mark is a blue and orange ring
around a _white_ droplet, and the generator preset defaults the maskable and apple
icons to a white background — which erases the middle of it. The near-black the dark
theme uses gives all three colours something to read against.

### Updates

`registerType: 'prompt'`, and `skipWaiting` is deliberately absent: a new service
worker waits rather than reloading the page under someone mid-import. `UpdateBanner`
is what offers it — a sticky bar with **Update**, which activates the waiting worker
and reloads, and **Later**, which hides it.

`useAppUpdate` asks for a new worker hourly _and_ whenever the tab becomes visible: a
tab left open, or an installed app sitting backgrounded, can go days without a
navigation. Dismissal is per-detection rather than permanent — the banner records
which `detectionToken` it was dismissed at, so tapping Later hides that update and a
genuinely new one brings the banner back.

**`detectionToken` counts distinct waiting workers, by identity, not checks.** The
same worker stays in `waiting` after Later, so a token bumped on "is something
waiting?" would advance on the very next poll and put the dismissed banner straight
back — Later would last about a minute. `noteWaiting` compares against the worker it
last counted, and both the poll and workbox's `onNeedRefresh` go through it, so
neither can count the same worker twice.

The banner mounts above the sign-in / signed-in branch in `app.tsx`, so an update is
offered on every screen including sign-in, from a single service worker registration.

**`update()` reloads on a timer as well as on `controllerchange`, and needs to.**
Workbox reloads the page when the new worker takes over, but that event only fires if
there was a controller to change — and a page that installed the service worker on
this very load is uncontrolled, because nothing here calls `clients.claim()`. Without
the timer the worker activates, the page never reloads, and the banner just sits
there: the button reads as broken. If workbox gets there first the timer dies with
the page, so it only ever fires when it was needed.

### Offline

The precached shell means the app now paints offline. What it paints is
`OfflineNotice` — "No connection", and a Try again that reloads. Nothing behind it
works offline and the screen doesn't pretend otherwise.

Detecting it takes three signals, and the obvious one is the least useful.

`useSession()` **does not hang offline** — the fetch rejects in about a millisecond.
So the pending state clears, the session resolves to nothing, and the app would
cheerfully offer the sign-in screen to someone with no connection, inviting them to
type an email that goes nowhere. Its `error` is what actually catches this, and it
does the bulk of the work.

But **not every session error means offline**, which is what `isUnreachable` is for.
A 4xx is the server answering, and an expired or rejected session belongs on the
sign-in screen: routed to the notice instead, the only thing on offer is a Try again
that can do nothing but repeat the same 401. A transport failure has no real status —
better-fetch reports one as `500 Fetch Error` — so 500-and-up, or no status at all,
is unreachable and 4xx is not.

`navigator.onLine === false` catches it before a request is even attempted. The
inverse is not usable: `true` covers a captive portal, a dead uplink and a Worker
that is down. `useStalled` covers the opposite failure to a fast rejection — a
connection accepted and then never answered — and fires after six seconds of pending.

The notice only shows while signed out or still resolving. Once there is a session, a
dropped connection belongs to the individual panels — they already say "Couldn't
reach the server" — and replacing the whole app would throw away whatever the user
was in the middle of.

### Verifying any of this

None of it is unit-testable here: the `unit` vitest project is node-only with no
jsdom, and service workers, installability and the offline screen only exist in a
real browser. Check them against `npm run preview`, which is a secure context on
localhost so the worker registers:

- the worker activates, and a reload leaves the page controlled by it;
- Cache Storage holds the shell and the icons, and holds neither `og-default.png` nor
  the `parse-fit-*` chunk;
- **with the app installed, request a magic link and open it** — you must land signed
  in, and the verify request must show as a real network hit rather than
  `(ServiceWorker)`. This is the one that would hurt most and the one a passing test
  suite says nothing about;
- offline, a hard reload shows "No connection" rather than a blank page;
- deploy a second build, and the banner appears, Update lands on it, and Later hides
  it until a genuinely new detection.

Note that `vite preview` computes asset ETags once at startup, so rebuilding
underneath a running preview is invisible to the browser — it revalidates and gets a 304. Restart the preview between builds when testing the update flow.

### If the service worker ever misbehaves in production

`VitePWA({ selfDestroying: true })` builds a worker that unregisters itself and
clears its caches. Deploy that, let it reach everyone, then revert. It is the escape
hatch worth knowing about before you need it.

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
npm run pwa-assets     # regenerate the PWA icons from public/favicon.svg (manual)
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
`~/shiftsync`, so if `SOPS_AGE_KEY` is already in your shell it Just Works.
**Variable names stay readable in `git diff`; values and comments do not** — sops
encrypts comment lines too (`type:comment`), so a diff tells you which keys
changed but not what any of it says. From the repo root:

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

**What is in here is development-only, and that is the whole rule.** The file
holds a throwaway VAPID pair so push works out of the box on every machine, and a
dev `BETTER_AUTH_SECRET`. Production secrets are Cloudflare secrets — the Worker
reads them from there and never from this file — so they are set with
`npm run secret` and do not live in the repo, encrypted or otherwise. Anyone with
`SOPS_AGE_KEY` and read access can decrypt this file; that is fine for values
that protect nothing real, and the reason production keys stay out.

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

Everything under `/api` needs a session except `/api/auth/*`, `/api/health`,
`/api/version`, and the two watch-pairing routes (`/api/device/code` and
`/api/device/token`, which are anonymous by construction — a watch has no cookie
yet, and getting one is the point). The guard is registered before the routes, so
anything added later is closed unless it's deliberately opened. `PUBLIC_PATHS` in
`worker/index.ts` is the list; keep this paragraph in step with it.

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

### Versioning

The companion's version is a **monotonic integer**, and it lives in git tags —
`companion-v1`, `companion-v2` — and nowhere else. `package.json` stays at `0.0.0`;
there is no semver and no changelog. (The watch is different: it hand-bumps
`Version.mc` and gets a changelog entry on the marketing site. The two are separate
products with separate release cadences.)

The deploy workflow does it in three jobs:

1. **`version`** lists the `companion-v*` tags, keeps the ones that are the prefix
   followed by digits and nothing else, takes the highest **number** and adds one.
   Highest number rather than newest tag, because `taggerdate` is at the mercy of
   clock skew and of a tag being recreated. A malformed tag is skipped rather than
   counted — counted, it would sort above every real one and reset the sequence to
   `1`, and the post-deploy check couldn't catch that, since the number it asserts
   would agree. No tags at all — the first ever deploy — starts at `0`, so the
   first build is `companion-v1`.
2. **`deploy`** passes that number to `integrity-check` as `COMPANION_BUILD`. The
   `define` in `vite.config.ts` bakes it into `__APP_VERSION__`, which reaches both
   the client bundle and the Worker, because they are one `vite build`. The later
   `wrangler deploy` does not rebuild — the Cloudflare Vite plugin writes
   `.wrangler/deploy/config.json`, which redirects wrangler at the already-built
   `dist/sparmin_companion/wrangler.json`, so what ships is the bundle that
   `integrity-check` produced.
3. **`tag`** pushes `companion-v<N>`, and **`verify`** curls `/api/version` and
   asserts the number came back. Both `needs:` the deploy, so a failed deploy is
   never tagged and the number stays free for the next attempt.

`verify` runs _alongside_ `tag`, not before it. Once `wrangler deploy` has
succeeded, build N is live whether or not the endpoint answers correctly for it —
and a number that is live but untagged gets handed straight back out to the next
run, so two deploys end up answering to one build. The tag records what happened;
`verify` says whether it went well, and fails the run on its own.

It retries on the _wrong_ answer as well as on no answer. A deploy takes a moment to
reach every edge, and until it does the previous Worker is still serving — which on
the very first deploy of that route meant a `401`, because the old build's guard had
never heard of `/api/version`. Its `set -o pipefail` is load-bearing for the same
reason: a command substitution takes the exit status of the _last_ command in the
pipeline, so without it a failed `curl` still looks successful, because `jq` exits 0
on empty input.

Locally and on PRs `COMPANION_BUILD` is unset and the build is honestly labelled
`dev`.

Read it two ways: `curl https://sparmin-app.scottlovegrove.co.uk/api/version`, or
the line at the bottom of the app's Settings screen. They are the same build by
construction.

**One failure mode to know.** If the deploy goes green but the tag push fails, the
number is never recorded and the next deploy claims it again — two deploys, one
build number. Re-running the `tag` job fixes it.

**Why the version isn't read directly.** `src/lib/app-version.ts` guards with
`typeof __APP_VERSION__ === 'string'` rather than reading the global outright. A
`define` is a textual substitution at build time, and nothing substitutes it under
vitest: the worker test pool takes its defines from wrangler's config, not Vite's,
so supplying it there would mean a second, stale copy of the number in
`wrangler.jsonc` — which the Cloudflare Vite plugin might then apply to the real
build. The guard is what makes `dev` the answer in tests instead of a
`ReferenceError`, and the post-deploy assertion is what stops it quietly becoming
the answer in production too.

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

No other secret is needed. The `tag` job pushes with the built-in `GITHUB_TOKEN`,
which is why that one job — and only that job — declares
`permissions: contents: write`; the workflow default stays `contents: read`.
