# Watch → Companion Sync — Technical Spec

**Status:** proposed. Nothing built.
**Date:** 1 August 2026

Extends [`spa-logger-spec.md`](./spa-logger-spec.md); section references prefixed
`SL§` point at that document. Where the two disagree, this one is newer.

The goal: a session recorded on the watch appears in the companion app on its
own, with no export, no drag-and-drop, and no Garmin account anywhere in the
path.

---

## 1. Why this shape

`SL§1` chose manual FIT export explicitly to avoid "watch auth + pairing" in v1.
That was the right call then. Three things have changed since:

- **The watch already has the client.** `apps/watch/source/BackendClient.mc` is
  written and unreferenced: a JSON POST, an offline queue in
  `Application.Storage`, and a flush-on-next-launch retry. Its URL constant is a
  placeholder. `SessionManager.buildPayload()` builds the body and is covered by
  `testBuildPayloadShape`.
- **Going via Garmin was investigated and rejected.** The unofficial Connect API
  does work — station labels survive into it, and a full session reconstructs
  exactly — but it needs a stored credential that can _write_ to a user's Garmin
  account, has no MFA support in any current Node library, and rests on private
  endpoints. The official Developer Program was already ruled out in `SL§8`.
  Pushing from the watch needs no Garmin relationship at all.
- **Manual import stays.** It is the only way to bring in a back-catalogue, and
  it is the fallback whenever a push fails permanently. This spec adds a second
  path; it does not replace the first.

### 1.1 The two sources are not copies of each other

This is the crux of the design, and the reason ingest becomes a merge rather
than a race.

| Field                              | FIT import                    | Watch push               | Notes                                                              |
| ---------------------------------- | ----------------------------- | ------------------------ | ------------------------------------------------------------------ |
| Device serial / product            | ✅                            | ❌                       | No Connect IQ API exposes `file_id.serial_number`                  |
| Session + per-lap calories         | ✅                            | ❌                       | Garmin computes these; the app never reads them                    |
| `total_timer_s`, per-lap `timer_s` | ✅                            | ❌                       | Garmin's own timing                                                |
| Per-lap `cycles` (steps)           | ✅                            | ❌                       | Sparse even in the FIT                                             |
| `utc_offset_s`                     | ✅                            | ❌                       | See §4.3 — the watch can supply it, but doesn't                    |
| Station identity                   | Display name                  | **Canonical id**         | The FIT carries `Himalayan salt sauna`; the app knows `salt_sauna` |
| Per-station **minimum** HR         | ❌                            | ✅                       | FIT laps carry avg/max only; `Segment` tracks min                  |
| Availability                       | Minutes to days later, manual | Seconds later, automatic |                                                                    |

So neither source dominates. A session that arrives both ways should end up
richer than either alone.

---

## 2. Linking a watch to an account

The watch can display text but cannot practically accept it — there is no
keyboard, and the intended flow must work while standing in a changing room.

**Use the OAuth 2.0 Device Authorization Grant (RFC 8628)** — the flow a smart TV
uses. The device shows a short code; the human approves it on a device that does
have a keyboard.

Two alternatives were considered and are not chosen:

- **Connect IQ app settings** (`Application.Properties`, edited in Garmin Connect
  Mobile). Least code by far — no pairing endpoints at all. Rejected on UX and on
  where the secret ends up: it means pasting a long token into Garmin's settings
  screen, after which the token lives in Garmin's settings sync. Keep it in mind
  as a fallback if the device-code flow proves awkward on a specific device.
- **`Communications.makeOAuthRequest`.** The native flow, but more moving parts,
  and the app supports Connect IQ 3.1 devices (a 3.1 launch crash was fixed in
  0.5.1). Its availability and behaviour across that range needs verifying before
  it could be chosen; the device-code flow needs nothing but `makeWebRequest`,
  which the app already depends on.

### 2.1 The flow

1. On the watch: **Settings → Link account**. The app POSTs `/api/device/code`
   with its product and a client-generated device install id (§4.1).
2. The Worker returns a `userCode`, a `deviceCode`, a poll `interval` and an
   `expiresIn`. It stores the pair unapproved.
3. The watch displays the `userCode` — e.g. **`K7QM-42`** — and begins polling
   `/api/device/token` with the `deviceCode`.
4. On any browser, signed in to the companion (magic link or passkey, `SL§6`),
   the user opens **Settings → Link a watch** and types the code.
5. The page shows what is asking — product, and how long ago it asked — and the
   user confirms.
6. The next poll returns a device token. The watch stores it in
   `Application.Storage` and shows "Linked". `BackendClient` sends it as
   `Authorization: Bearer …` from then on.

The user code is the only thing a human handles, it is short-lived, and it is
useless without the device code, which never leaves the watch.

### 2.2 Code format

- **User code:** 6 characters, `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — no `0`/`O`,
  no `1`/`I`. Displayed hyphenated (`K7QM-42`), compared case-insensitively with
  hyphens and whitespace stripped.
- **Device code:** 32 bytes of CSPRNG, base64url. The secret half.
- **Lifetime:** 10 minutes. Single use. Approving consumes it.
- **Poll interval:** 5 seconds, with `slow_down` backoff as RFC 8628 describes.

### 2.3 Endpoints

| Method   | Route                       | Auth           | Notes                                                                                                      |
| -------- | --------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/device/code`          | none           | Body: `{ product, installId }`. Returns `{ userCode, deviceCode, interval, expiresIn }`                    |
| `POST`   | `/api/device/token`         | none           | Body: `{ deviceCode }`. `authorization_pending` \| `slow_down` \| `expired_token` \| `{ token, deviceId }` |
| `POST`   | `/api/device/approve`       | session cookie | Body: `{ userCode }`. Binds the pending code to the current user                                           |
| `GET`    | `/api/device/pending/:code` | session cookie | What is asking, so the confirm screen can describe it before approval                                      |
| `GET`    | `/api/devices`              | session cookie | Linked devices, with `lastSeenAt`                                                                          |
| `DELETE` | `/api/devices/:id`          | session cookie | Revoke. The watch's next POST gets `401` and it clears its token                                           |

Unauthenticated routes are rate-limited: `/api/device/code` per IP,
`/api/device/token` per device code, `/api/device/approve` per user session with
a lockout after repeated bad codes. A `userCode` is only 6 characters from a
32-symbol alphabet, so guessing must be made expensive rather than merely
improbable.

### 2.4 Token handling

- The device token is opaque, 32 bytes, base64url. It is **not** a better-auth
  session — it does not expire on its own and grants exactly one capability:
  ingest for its owner.
- **Store only a SHA-256 hash**, as with any API key. The plaintext is returned
  once, to the watch, and never again.
- Revocation is immediate — `DELETE /api/devices/:id` sets `revoked_at`, and
  lookups filter it out.
- `last_seen_at` updates on each accepted ingest, so the settings screen can show
  a watch that has quietly stopped talking.

---

## 3. Ingest and reconciliation

### 3.1 Why the current dedupe key cannot hold

```
schema.ts:47   deviceSerial: text('device_serial').notNull()
schema.ts:58   unique('sessions_dedupe').on(userId, deviceSerial, startedAt)
```

`device_serial` is `file_id.serial_number`, which no Connect IQ API exposes. A
watch push cannot populate a `NOT NULL` column, and two rows keyed on a column
only one source can fill will never collide — so a session pushed live and later
imported from its FIT lands twice.

### 3.2 Matching on time

The two sources genuinely do agree on start time. `SessionManager._beginSession`
takes `now` from `Time.now().value()` in the same call that runs
`Recorder.startSession()` → `ActivityRecording.Session.start()`, which is what
Garmin stamps as `session.start_time`. They should differ by at most a second or
two.

"At most a second or two" is fatal to an exact `UNIQUE` constraint and fine for a
window. **Match on `user_id` and `started_at` within ±5 minutes.**

That tolerance is set by how close two real sessions ever start. Across 123
recorded sessions the two closest starts were **23.8 minutes** apart, and only
four pairs fell inside an hour:

```
23.8 min, 28.0 min, 46.8 min, 52.0 min, then 8 hours+
```

±5 minutes is roughly a fifth of the tightest observed gap — wide enough to
absorb any plausible clock skew, nowhere near wide enough to swallow a genuine
second visit. It is a constant, `SESSION_MATCH_WINDOW_S = 300`, not a magic
number sprinkled through the ingest code.

A window cannot be expressed as a SQL `UNIQUE`, so matching is an application
concern: `SELECT` inside the ingest transaction, then insert or merge.

### 3.3 What actually deduplicates a retry

The window handles _cross-source_ matching. It is the wrong tool for the same
source arriving twice, which is a real case — `BackendClient`'s offline queue
re-POSTs after a failure, and a response lost on the way back looks identical to
a failure.

The watch already generates a per-session UUID (`_sessionId`, in the payload as
`sessionId`). Store it as `watch_session_id` with a `UNIQUE` constraint. A repeat
POST of the same payload hits it and returns `200` with the existing session,
not `409` — a queue flush that re-sends is normal operation, not an error.

### 3.4 Merge rules

Ingest resolves to one of three outcomes:

| Situation                                          | Outcome                                |
| -------------------------------------------------- | -------------------------------------- |
| No session within the window                       | Insert. `source` = the arriving source |
| Match, and the arriving source already contributed | No-op, return the existing session     |
| Match from the other source                        | **Merge**, `source` → `both`           |

Merging fills gaps; it does not overwrite. Concretely:

- **Never overwrite a non-`NULL` value with `NULL`.**
- **FIT wins** on everything Garmin computed: calories, timer times, `cycles`,
  `device_serial`, `device_product`, `utc_offset_s`, and the session totals. It
  measured them; the watch didn't.
- **Watch wins** on `min_hr`, which the FIT does not carry at all, and on station
  identity — the canonical id is better than a display name that could be
  renamed later.
- **`started_at` stays as first written.** Rewriting it would move the row
  relative to any window match still in flight.
- Intervals are matched within a session by order, not by timestamp — the watch
  emits activity segments only, while the FIT emits every lap including
  transitions, so the two lists are different lengths by construction. The FIT
  list is the spine; watch segments attach to it in order.

Write the whole merge in one `db.batch()`, as `SL§5.2` already requires for
imports.

### 3.5 Schema changes

```sql
-- sessions
ALTER TABLE sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'fit'
    CHECK (source IN ('fit','watch','both'));
ALTER TABLE sessions ADD COLUMN watch_session_id TEXT;
ALTER TABLE sessions ADD COLUMN device_id TEXT REFERENCES devices(id);
CREATE UNIQUE INDEX idx_sessions_watch_uuid
    ON sessions (watch_session_id) WHERE watch_session_id IS NOT NULL;

-- device_serial must become nullable, and the old dedupe key must go.
-- SQLite cannot drop NOT NULL or a constraint in place: rebuild the table
-- (new table, INSERT … SELECT, drop, rename) inside the migration.
--   device_serial TEXT            -- nullable; NULL when the session came from the watch
--   (drop UNIQUE (user_id, device_serial, started_at))
CREATE INDEX idx_sessions_user_started ON sessions (user_id, started_at);

-- station_intervals
ALTER TABLE station_intervals ADD COLUMN min_hr INTEGER;

CREATE TABLE devices (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  install_id   TEXT NOT NULL,            -- the watch's own id for itself (§4.1)
  product      TEXT,                     -- 'vivoactive5' | 'fr745' | …
  name         TEXT,                     -- user-editable label
  token_hash   TEXT NOT NULL,            -- SHA-256 of the device token
  serial       TEXT,                     -- learned from a matched FIT import, if ever
  linked_at    INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at   INTEGER,
  UNIQUE (user_id, install_id)
);

CREATE TABLE device_link_codes (
  user_code        TEXT PRIMARY KEY,     -- normalised: upper-case, no hyphen
  device_code_hash TEXT NOT NULL UNIQUE,
  install_id       TEXT NOT NULL,
  product          TEXT,
  user_id          TEXT REFERENCES users(id) ON DELETE CASCADE,  -- NULL until approved
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  approved_at      INTEGER,
  consumed_at      INTEGER
);
```

Expired link codes are swept on write — there is no cron, and the table only
grows by one row per link attempt.

### 3.6 Ingest responses

`POST /api/sessions/watch` (separate from `SL§5`'s FIT ingest — different payload
shape, different auth):

| Code  | Meaning                                                                                       |
| ----- | --------------------------------------------------------------------------------------------- |
| `201` | Created                                                                                       |
| `200` | Already had it — same `watch_session_id`, or merged into a match                              |
| `401` | Unknown, revoked or malformed device token. The watch clears its token and shows "Link again" |
| `400` | Payload failed validation                                                                     |

`401` is the only response the watch treats as terminal. Everything else it
either accepts or re-queues.

---

## 4. The watch side

### 4.1 Device install id

The watch needs a stable self-identifier, so that re-linking the same watch
updates a row rather than accumulating them.

`System.getDeviceSettings()` is documented to expose a `uniqueIdentifier` —
**confirm this exists and is stable across app reinstalls on both target devices
before relying on it.** If it does not hold up, generate a UUID on first run and
persist it in `Application.Storage`; that is stable across restarts and lost on
reinstall, which is acceptable — a reinstall then needs a re-link.

Note this id is _not_ the FIT serial number and cannot substitute for it. The
`devices.serial` column is left nullable and populated opportunistically: when a
FIT import merges into a session already owned by a device, that FIT's serial can
be written back. It is a convenience for display, never a key.

### 4.2 Link screen

A new view under Settings. It shows the code in the largest legible type, a
countdown to expiry, and one of: waiting, linked, expired, or failed. Back
cancels the attempt.

The screen polls while it is in the foreground, which sidesteps every Connect IQ
background-execution limit — the flow is inherently attended, since someone is
typing the code elsewhere. Ten minutes of 5-second polls is 120 requests, well
within a foreground app's budget.

Per `apps/watch/AGENTS.md`, the delegate extends `WatchUi.InputDelegate` and must
answer `SWIPE_RIGHT` — here that means cancel the link attempt and pop.

### 4.3 Payload additions

`buildPayload()` currently emits `sessionId`, `startedAt`, `endedAt`,
`totalSeconds`, `transitionSeconds`, `activities`, `segments`. Three additions:

- **`utcOffsetS`** — from `System.getClockTime().timeZoneOffset`. `Iso.fromEpoch`
  formats UTC, so the payload currently carries no local-time information at all,
  and `sessions.utc_offset_s` would stay `NULL` for a watch-only session.
- **`installId`** — so a session can be attributed to a device even if the token
  is later rotated.
- **`appVersion`** — `Version.APP`. Cheap, and worth having when a future payload
  bug needs pinning to a release.

Calories are deliberately **not** added. The watch would have to read
`Activity.getActivityInfo()` and the value would be Garmin's running estimate
mid-session rather than its final computed figure, which is what the FIT carries.
Leave the column `NULL` for watch-only sessions and let a later FIT import fill
it — that is exactly what §3.4 is for.

### 4.4 Wiring `BackendClient`

- Replace the placeholder `URL` with the real host, from a build-time constant.
- Send the device token as `Authorization: Bearer`; skip sending entirely, with a
  clear message, when no token is stored.
- Call `send()` from `confirmEnd()` — after `_recorder.finish()`, so a network
  failure can never affect the recording. The FIT is the source of truth and must
  already be safe on disk before anything is transmitted.
- Call `flushQueue()` on app start, as its own comment already intends.
- Cap the queue (say 20 sessions) and drop oldest-first. An unbounded queue in
  `Application.Storage` is a memory risk on a watch, and a session that failed to
  send for weeks can still be recovered from its FIT.

---

## 5. Security

- **The device token is a bearer credential for ingest only.** It cannot read,
  cannot delete, and cannot touch account settings. Worst case for a leaked token
  is fabricated sessions in one account.
- **Hash at rest.** Only SHA-256 hashes are stored; a database read cannot yield
  a usable token.
- **Approval is bound to a live session cookie.** Nothing links without an
  authenticated human confirming, and the confirm screen names the device.
- **The window is a write-side concern only.** Merging never crosses `user_id`,
  so no timing behaviour can attach one user's session to another.
- **Revocation is user-visible and immediate**, listed in settings with
  `last_seen_at`.

---

## 6. Build order — PR plan

| PR    | Scope                                                                                                                                                                                           | Testable by           | Depends on |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------- |
| **1** | **Schema + migration** — `devices`, `device_link_codes`, the `sessions` rebuild (nullable `device_serial`, drop old key, `source`, `watch_session_id`, `device_id`), `station_intervals.min_hr` | `wrangler d1`, Vitest | —          |
| **2** | **Reconciliation in the existing FIT ingest** — window match, merge rules (§3.4), `source` tracking. No new source yet; behaviour under FIT-only import is unchanged                            | Vitest                | 1          |
| **3** | **Device link endpoints** — `/api/device/*`, `/api/devices`, hashing, rate limits, code sweep                                                                                                   | Vitest + curl         | 1          |
| **4** | **Watch ingest** `POST /api/sessions/watch` — Zod schema shared with the watch payload, bearer auth, merge via PR2                                                                              | Vitest + curl         | 2, 3       |
| **5** | **Companion UI** — "Link a watch" confirm screen, linked-device list, revoke                                                                                                                    | manual                | 3          |
| **6** | **Watch: link screen + install id** — settings entry, code display, polling, token storage                                                                                                      | simulator + device    | 3          |
| **7** | **Watch: wire `BackendClient`** — payload additions (§4.3), send on `confirmEnd`, flush on start, queue cap                                                                                     | simulator + device    | 4, 6       |

PR2 before any of the device work is deliberate: reconciliation is the part that
can corrupt existing data, and it is fully testable against FIT imports alone
before a second source exists.

PRs 6 and 7 are a release each (`apps/watch/AGENTS.md`): version bump plus a
changelog entry in `apps/marketing`.

---

## 7. Open items

- **`System.getDeviceSettings().uniqueIdentifier`** — confirm it exists, and is
  stable across reinstalls, on vívoactive 5 and fr745 (§4.1). The fallback is a
  generated UUID.
- **Connect IQ 3.1 devices.** The link screen and `makeWebRequest` need checking
  across the supported range, the same way the 0.5.1 launch crash did. If linking
  cannot work there, those devices keep manual FIT import and the settings entry
  is hidden.
- **±5 minutes is drawn from one user's data.** 123 sessions, one watch, one spa.
  It is a constant so it can be revisited; if sessions ever get logged
  back-to-back the window has to shrink, and the schema does not depend on its
  value.
- **Two sources, two clocks.** If a watch's clock is materially wrong the window
  match fails and the session lands twice. Detectable — same duration, same
  station sequence, different start — but not handled. Worth a "looks like a
  duplicate" hint in the UI rather than automatic merging on anything looser than
  time.
- **Editing a merged session.** `SL§` has no edit surface yet. When it arrives,
  decide what happens if a later FIT import merges into a session the user has
  already corrected by hand.
