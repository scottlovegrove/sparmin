# Thermal Spa Session Logger — Technical Spec

**Status:** v1 scope agreed. Stats deliberately deferred.
**Date:** 16 July 2026
**Revised:** 16 July 2026 — reconciled against the actual watch code
(`apps/watch/source/`); topology settled as a single Worker; PR plan added (§2).

Lives in this monorepo as a new workspace: **`apps/companion`**.

---

## 1. Architecture

**One deployable app, not two.** A single Cloudflare Worker serves the built
frontend assets (via the wrangler `assets` binding) *and* the Hono `/api/*`
routes. Same-origin by construction — no CORS, and better-auth's magic-link
session cookie works without the cross-origin cookie dance. "Cloudflare Pages"
as a separate product is not used; there is no existing Pages/PWA pattern in this
repo to inherit (the sibling `apps/marketing` is Astro on GitHub Pages, unrelated
tooling).

Deployment topology (one Worker) is independent of frontend richness: the SPA can
grow charts, date pickers and the deferred Stats screens without changing this.

| Layer | Choice | Why |
|---|---|---|
| Watch | Connect IQ app (vívoactive 5, Forerunner 745 / `fr745`) | Records FIT with one lap per activity |
| Ingest | Manual FIT export → drag into the SPA | Avoids watch auth + pairing entirely for v1 |
| Parsing | Client-side, Garmin FIT SDK (JS) | Keeps FIT binary out of the Worker; no Worker CPU burn. A code boundary, not a deployment one — the same Worker serves the page whose JS parses |
| Frontend | React + Vite SPA, served by the Worker as static assets | Room for charts / date pickers / Stats without a later migration |
| API | Hono on the same Cloudflare Worker | Native D1 binding — `env.DB`, no connection string |
| DB | Cloudflare D1 (SQLite) | Free tier, no pooler, no pause, Time Travel backups |
| Auth | better-auth, magic link | Runs on Workers, D1 store via Drizzle; same-origin cookie |
| Email | Cloudflare Email Service or Resend | Check CF Email Service GA status first |

**Cost:** free at hobby scale. Only email has a meaningful ceiling.

Shared Zod schemas/types live once in the workspace and are imported by both the
client parser and the server ingest — one source of truth for the §5.1 payload.

---

## 2. Build order — PR plan

Delivered as seven small, independently reviewable PRs rather than a few mammoth
ones. Each is mergeable on its own and (from PR1 on) testable.

| PR | Scope | Testable by | Depends on |
|---|---|---|---|
| **0** | **Workspace scaffold.** New `apps/companion`: `package.json`, `wrangler.jsonc` (Worker + `assets` binding), React+Vite SPA skeleton, Hono skeleton with a health route, Vitest + `@cloudflare/vitest-pool-workers`, Drizzle config, oxlint/oxfmt wired into the root | `wrangler dev` | — |
| **1** | **FIT parser** — pure `ArrayBuffer → SessionPayload`, Garmin FIT SDK, Vitest against real FIT fixtures. **Starts by dumping a real exported FIT** to confirm §4.3 quirks and which fields (§3 note) are actually present | Vitest | 0 |
| **2** | **Schema + migrations + stations seed** — D1 schema (Drizzle), migrations, seed `stations` from the CIQ enum (§3 note), `GET /api/stations` | `wrangler d1` + `EXPLAIN QUERY PLAN` | 0 |
| **3** | **Ingest** `POST /api/sessions` — Zod validation, dedupe (409), 422/400, `db.batch` write, unclassified auto-insert. Auth stubbed | curl + Vitest | 1, 2 |
| **4** | **Read/delete** `GET /api/sessions` (paginated), `GET /:id` (+intervals), `DELETE /:id` | Vitest | 2, 3 |
| **5** | **Auth** — better-auth magic link, Drizzle/D1 store, email provider, guard `/api/*`. Real `user_id` replaces the stub | manual login | 3, 4 |
| **6** | **Upload UI** (React SPA) — dropzone → client parse (PR1) → POST → duplicate/error/success states | manual | 1, 3, 5 |

- PRs 2–4 are testable with `wrangler dev` and curl. Auth is not a blocker for
  either — it lands in PR5 and is retrofitted onto the endpoints.
- Auth precedes the UI so PR6 targets the real guarded endpoint (same-origin
  cookie, no CORS).
- **PR1's fixture capture doubles as the fact-check** for the "present?" fields
  in §3/§4 (calories, sweat loss, cycles, device product string). Resolve those
  into this spec before PR2 freezes the schema.
- **Stats** — deferred (§8). Schema supports it; nothing built yet.

---

## 3. Data model

SQLite / D1 dialect.

```sql
-- users: owned by better-auth (id, email, emailVerified, createdAt, …)

-- Seeded from the CIQ app's hardcoded station enum via migration.
-- Closed set by construction: every name originates from the watch app.
CREATE TABLE stations (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,     -- raw `activity` dev field value
  thermal_class TEXT NOT NULL DEFAULT 'unclassified'
                CHECK (thermal_class IN ('hot','cold','neutral','unclassified')),
  is_transition INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  id                  TEXT PRIMARY KEY,     -- uuid v4, generated client-side
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at          INTEGER NOT NULL,     -- unix seconds, UTC
  ended_at            INTEGER NOT NULL,     -- unix seconds, UTC
  utc_offset_s        INTEGER,              -- from activity.local_timestamp - activity.timestamp
  device_serial       TEXT NOT NULL,        -- file_id.serial_number
  device_product      TEXT,                 -- e.g. 'vivoactive5' | 'fr745' (confirm from a real FIT)
  -- FIT session message totals, stored verbatim (not derived)
  total_elapsed_s     REAL NOT NULL,
  total_timer_s       REAL,
  total_calories      INTEGER,
  total_sweat_loss_ml INTEGER,
  avg_hr              INTEGER,
  max_hr              INTEGER,
  created_at          INTEGER NOT NULL,
  UNIQUE (user_id, device_serial, started_at)   -- dedupe key
);

CREATE TABLE station_intervals (
  id               INTEGER PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- denormalised
  station_id       INTEGER NOT NULL REFERENCES stations(id),
  lap_index        INTEGER NOT NULL,        -- FIT lap.message_index, preserves order
  started_at       INTEGER NOT NULL,        -- lap.start_time
  ended_at         INTEGER NOT NULL,        -- DERIVED (see §4.3)
  elapsed_s        REAL NOT NULL,
  timer_s          REAL,
  avg_hr           INTEGER,
  max_hr           INTEGER,
  calories         INTEGER,
  resting_calories INTEGER,
  sweat_loss_ml    INTEGER,
  cycles           INTEGER,                 -- step count, only present on transitions
  UNIQUE (session_id, lap_index)
);

CREATE INDEX idx_sessions_user_time     ON sessions (user_id, started_at DESC);
CREATE INDEX idx_intervals_session      ON station_intervals (session_id, lap_index);
CREATE INDEX idx_intervals_user_station ON station_intervals (user_id, station_id, started_at);
```

### Design notes

- **`is_transition` lives on `stations`.** "transition" is one member of the enum; the property belongs to the station, set once, not repeated per lap.
- **Seed source is `SpaActivity.mc`.** The watch writes the station's **display name** (not its id) into the FIT lap field — e.g. `Himalayan salt sauna`. Seed `stations.name` from `SpaActivity.NAMES` (10 entries) **plus the literal `transition`** (`is_transition = 1`; it's what `SessionManager.LABEL_TRANSITION` writes for transition laps). The app's canonical ids (`salt_sauna`, …) never appear in the FIT and are not the join key here; if a stable slug is ever wanted, add a `slug` column later — for v1 the name is the key.
- **Calories / sweat loss / cycles are Garmin-native and UNVERIFIED.** The watch app writes only sport/sub-sport, laps, HR, and the `activity`/`summary` dev fields — it does **not** compute `total_calories`, `total_sweat_loss_ml`, `resting_calories`, or `total_cycles` (step count). Whether Garmin natively populates these on a `SPORT_TRAINING`/`SUB_SPORT_CARDIO_TRAINING` indoor activity is device-dependent and must be confirmed against a real exported FIT (PR1) before relying on them. All are nullable here on purpose; treat absent = `NULL`, never 0.
- **`user_id` denormalised onto `station_intervals`.** Deliberate. Every cross-session stat filters by user, and D1 is single-threaded — index directly rather than join through `sessions` on every read.
- **Session totals stored verbatim AND derivable from laps.** Garmin's own totals are the source of truth for the session; per-station rollups are computed.
- **Indexes matter more than usual.** D1 is single-threaded: an unindexed scan blocks every queued query. Verify with `EXPLAIN QUERY PLAN` — want `SEARCH TABLE USING INDEX`, never `SCAN TABLE`.

---

## 4. FIT parsing contract

### 4.1 Messages read

| Message | Fields | → |
|---|---|---|
| `file_id` | `type` (must be `activity`), `serial_number`, `product`, `time_created` | device identity + dedupe key |
| `activity` | `timestamp`, `local_timestamp` | `utc_offset_s = local_timestamp - timestamp` |
| `session` | `start_time`, `total_elapsed_time`, `total_timer_time`, `total_calories`, `avg_heart_rate`, `max_heart_rate`, sweat loss | session row, verbatim |
| `lap` × N | `message_index`, `start_time`, `total_elapsed_time`, `total_timer_time`, `avg_heart_rate`, `max_heart_rate`, `total_calories`, `total_cycles`, est sweat loss, resting calories | one `station_intervals` row each |
| `field_description` | developer field defs | locate the station label field |

The watch (`Recorder.mc`) also writes a **second** developer field the parser can
ignore for v1: `summary` (developer field id `1`, scoped to `MESG_TYPE_SESSION`,
a string ≤240 chars) — a human-readable summary line. Noted so it isn't mistaken
for the station label; only the lap-scoped `activity` field (§4.2) matters for
ingest. Reminder from §3: calories / sweat loss / cycles in the `session`/`lap`
rows are Garmin-native, not app-written, and unverified until PR1.

`device_product` — do **not** hardcode `forerunner745`. The FIT `garmin_product`
name for the Forerunner 745 is `fr745` (the watch build target); read whatever
the SDK actually decodes from `file_id.product` and confirm both product strings
against a real FIT.

### 4.2 The station label

Written by the CIQ app (`Recorder.mc`) as a **FitContributor developer field
scoped to `MESG_TYPE_LAP`**, developer field id `0`, currently named `activity`,
carrying a string. The value is the station's **display name** (e.g. `Himalayan
salt sauna`), or the literal `transition` for transition laps.

- Match on `field_name` from the `field_description` message.
- **Accept a set of known field names**, not one literal — renaming the field in the CIQ app must not orphan previously-recorded files.
- Resolve the field *value* to `stations.id` by exact name match against `stations.name` (which was seeded from the same `SpaActivity.NAMES` strings, plus `transition`).

### 4.3 Known quirks — must handle

1. **`lap.timestamp` is unusable.** Every lap in observed files carries the *session start* (`08:46:02`) rather than the lap end. Derive:
   ```
   ended_at = lap.start_time + lap.total_elapsed_time
   ```
   Never read `lap.timestamp`. (Worth fixing in the CIQ app separately; the parser must not depend on it either way.)

2. **Trailing artefact lap.** Files end with a ~3s `transition` lap with `lap_trigger = session_end`. Stored as-is per decision — it's a real interval, just a tiny one. Any future stats should be aware.

3. **`total_cycles` is sparse.** Only populated on transitions (step count while walking). Nullable.

4. **FIT epoch.** FIT timestamps are seconds since `1989-12-31T00:00:00Z`. The JS SDK normally converts to `Date`; store unix seconds.

### 4.4 Validation — reject the file if

- `file_id.type !== 'activity'`
- No laps carry the station developer field → **reject** ("this doesn't look like a spa session")
- Any lap's station name is absent from `stations` → auto-insert as `unclassified` rather than reject. Safety net for CIQ/DB version skew; never lose a real session over it. Surface unclassified stations for later tagging.

---

## 5. API surface

Hono on Workers. All routes authenticated except `/api/auth/*`.

| Method | Route | Notes |
|---|---|---|
| `POST` | `/api/sessions` | Ingest. Body = parsed payload (§5.1) |
| `GET` | `/api/sessions` | List, paginated, `started_at DESC` |
| `GET` | `/api/sessions/:id` | Session + intervals |
| `DELETE` | `/api/sessions/:id` | |
| `GET` | `/api/stations` | The enum + thermal classes |
| `*` | `/api/auth/*` | better-auth handler |

### 5.1 Ingest payload

```jsonc
{
  "id": "uuid-v4",                     // client-generated, idempotency
  "device": { "serial": "3412345678", "product": "vivoactive5" },
  "session": {
    "startedAt": 1752652    ,          // unix seconds UTC
    "endedAt":   1752655    ,
    "utcOffsetS": 3600,
    "totalElapsedS": 2415.2,
    "totalTimerS": 2415.2,
    "totalCalories": 262,
    "totalSweatLossMl": 277,
    "avgHr": 96,
    "maxHr": 136
  },
  "laps": [
    {
      "lapIndex": 0,
      "station": "Himalayan salt sauna",
      "startedAt": 1752652    ,
      "elapsedS": 899.856,
      "timerS": 899.856,
      "avgHr": 100,
      "maxHr": 120,
      "calories": 115,
      "restingCalories": 29,
      "sweatLossMl": 106,
      "cycles": null
    }
    // …
  ]
}
```

Validate with Zod. The client is untrusted in principle; in practice the blast radius is a user's own data.

> **Note — the watch already has a different POST payload.** `BackendClient.mc` +
> `SessionManager.buildPayload()` already build and POST a JSON body, but its shape
> does **not** match this one: it sends the canonical `activityId` (not the display
> name), ISO-8601 strings (not unix seconds), includes `hrMin`, omits `lapIndex` /
> device serial / calories / sweat, and targets `…/sessions` (not `/api/sessions`).
> The deferred watch-push path (§8) claims "same ingest endpoint" — that is not yet
> true. When watch push is built, either the endpoint accepts both shapes or
> `buildPayload()` is changed to emit §5.1. Not a v1 concern (v1 ingest is FIT-only),
> but don't assume the existing watch payload drops straight in.

### 5.2 Responses

| Code | Meaning |
|---|---|
| `201` | Created |
| `409` | Duplicate — `(user_id, device_serial, started_at)` exists. Surface as "already imported", not an error |
| `422` | Not a spa session / no station dev field |
| `400` | Payload failed validation |

Write session + intervals in a single D1 batch (`db.batch()`) so a partial import can't land.

---

## 6. Auth

- **better-auth** magic-link plugin, Drizzle adapter, D1 store.
- **Same-origin cookie.** Because the SPA and API are one Worker (§1), the session cookie is first-party — no cross-origin `SameSite=None` / CORS credential juggling, which is the usual magic-link pain point.
- Email via **Cloudflare Email Service** (`EMAIL` binding, Wrangler emulates locally — check GA status and free allowance) or **Resend** (official Workers tutorial, free tier, domain verification).
- **MailChannels' free Workers service was sunset 31 Aug 2024** — ignore any blog post promising free Workers email.
- **Deliverability is the real risk.** SPF, DKIM and DMARC on the sending subdomain. A magic link in spam is an unrecoverable login.

---

## 7. Local development

```
db:generate      drizzle-kit generate
db:migrate:local wrangler d1 migrations apply DB --local
db:migrate:prod  wrangler d1 migrations apply DB --remote
dev              wrangler dev
```

- Local D1 is a real SQLite file at `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite` — open it with any SQLite client.
- Use `wrangler d1 migrations apply`, **never** `drizzle-kit migrate` (it wants d1-http creds and targets prod).
- Set `migrations_dir` + `migrations_pattern` (glob) in `wrangler.jsonc` so Drizzle's subfolder layout is picked up. The old "flatten migrations with a Node script" workaround is obsolete.
- `drizzle.config.ts` needs the local `.sqlite` path resolved via `readdirSync` over `.wrangler`, branching to the `d1-http` driver when `NODE_ENV=production`.
- Testing: `@cloudflare/vitest-pool-workers` — real bindings, real D1, isolated storage per test.
- **WSL2:** keep the repo on the Linux filesystem (`~/`), not `/mnt/c`.
- Seed realistic history: `wrangler d1 execute DB --local --file=./seed.sql`. Aggregates over three rows tell you nothing.

---

## 8. Deferred

- **Stats.** Schema supports per-session detail and cross-session trends (hot/cold minutes, sweat loss, HR recovery, streaks). Nothing built.
- **Watch push.** `Communications.makeWebRequest` + device pairing code, replacing manual export. Same ingest endpoint — but the existing `buildPayload()` shape differs from §5.1 (see the note there); reconcile before wiring it.
- **Venues.** Station names are hardcoded to one spa's circuit, so v1 only really serves people at that venue. A `venues` dimension is the unlock if this ever goes wider — worth remembering `stations.name` is currently globally unique, which is the constraint that'd have to give.
- **Garmin-derived metrics** (Body Battery, training load). Would require the official Garmin Connect Developer Program with per-user OAuth. Explicitly avoided.

---

## 9. Open items

- Confirm Cloudflare Email Service GA status + free allowance vs Resend.
- `lap.timestamp` in the CIQ app: likely **not** app-fixable — the watch only calls `addLap()`/`finish()`; Garmin owns the lap timestamp. Confirm whether it's controllable at all; if not, drop this item. The parser's `start_time + total_elapsed_time` derivation (§4.3) is self-sufficient regardless.
- Seed `stations` with the CIQ enum + thermal classes. **`Hydro pool` and `Heated loungers` need a judgement call** — neither is inferable from its name.
