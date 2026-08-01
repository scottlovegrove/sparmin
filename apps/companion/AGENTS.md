# apps/companion — agent rules

The thermal spa session logger: a React + Vite SPA served by a Hono Cloudflare
Worker with a D1 backend, deployed as one Worker. Build/run guide is in
[`README.md`](./README.md); the spec is in
[`../../docs/spa-logger-spec.md`](../../docs/spa-logger-spec.md). The house
TypeScript conventions in [`../../AGENTS.md`](../../AGENTS.md) apply in full — this
file only adds what's specific to this workspace.

## Tests

Vitest, two projects (see `vitest.config.ts`):

- **`unit`** — pure client/parser units under `src/**/*.test.ts`, run in node.
  These read FIT fixtures off disk from `test/fixtures/`.
- **`worker`** — worker/integration tests under `test/**/*.test.ts`, run inside
  workerd via `@cloudflare/vitest-pool-workers` against the real `wrangler.jsonc`
  bindings. Each isolated test DB is migrated and seeded by
  `test/apply-migrations.ts`; env values are pinned in `vitest.config.ts`, not
  read from the git-ignored `.dev.vars`.

### Reuse the shared test setup — don't re-roll it

Worker tests share setup through **`test/helpers.ts`** and
**`test/auth-helper.ts`**. Before writing a `beforeEach`, a payload literal, or a
request wrapper, reach for these. Re-rolling them by hand is the drift this file
exists to stop.

- **`signIn(email?)`** (`auth-helper.ts`) — sign in through the real magic-link
  flow and get back `{ headers, userId }`. Use its cookie in requests so tests go
  through the actual guard, never around it.
- **`resetUsers()`** — wipe `sessions`, `device_link_codes` and `user` between
  tests (cascades clean; `stations` seed data survives — link codes don't, since
  an unapproved one has no user to cascade from). Use as
  `beforeEach(resetUsers)`.
- **`resetWithPair()`** — `resetUsers()` plus two real sign-ins, `me` and `other`,
  for ownership/isolation tests. A made-up id can't stand in for a second user —
  the `user_id` foreign key means `other` must be a genuine account.
- **`sessionPayload(options)`** — the one `IngestPayload` factory. Defaults are a
  valid two-lap circuit; override only the field the test is about (`id`,
  `startedAt`, `laps`, `device`, or a shallow-merged `session`). Don't paste a
  fresh payload literal into a suite.
- **`stayLaps(startedAt, stays)`** — build laps from `{ station, elapsedS }` pairs
  when a test cares which station the time landed on, not the per-lap detail.
- **`postSession(who, body)`** — POST `/api/sessions` as `who`, returns the raw
  `Response`. **`seedSession(who, body)`** does the same but asserts `201`, for
  arranging state a test depends on.
- **`getJson<T>(path, who)`** — authenticated GET returning `{ status, body }`,
  typed by the caller, for read tests that only need those two things.
- **`uuid(n)`** — a readable, valid session uuid keyed by one digit
  (`uuid(1)`, `uuid(2)`, …), easy to eyeball in assertions.
- **`countRows(table)`** — `SELECT COUNT(*)`, 0 when empty.

When you add a helper other suites will want, put it in `test/helpers.ts` and add
it to the list above. When you find setup copy-pasted across suites, fold it into
a helper rather than adding a fourth copy.

### Fixtures

FIT fixtures live once in `test/fixtures/` (see its `README.md` for what each file
represents and why the older recordings are kept). Node unit tests read them off
disk; worker tests can't (workerd's filesystem isn't the repo's), so the bytes for
the one end-to-end ingest test are read in node by `vitest.config.ts` and passed
through as the `TEST_FIT_FIXTURE` binding. Don't add a second copy of a fixture or
a parallel loader — extend the existing path.

## Migrations

Generated with `npm run db:generate`, applied with `npm run db:migrate`. Two
things about this repo's setup will bite you if you don't know them.

**The journal has gaps.** `0001_seed_stations.sql` and `0004_seed_hot_tub.sql`
are hand-written and absent from `migrations/meta/_journal.json`, so drizzle-kit
numbers a new migration into a filename that already exists. Rename the file and
its snapshot, and write the journal entry by hand.

**Never let a table rebuild cascade.** SQLite can't drop a `NOT NULL` or a
`UNIQUE` in place, so drizzle-kit rebuilds the table: copy out, `DROP`, rename
in. It emits `PRAGMA foreign_keys=OFF` around that, **and the pragma does
nothing** — it is a documented no-op inside a transaction, and D1 runs every
migration file in one. Foreign keys stay enforced, so the `DROP` fires
`ON DELETE CASCADE` and silently deletes every dependent row, while the table
being rebuilt survives intact because its rows were already copied out.

This is not hypothetical: it destroyed every `station_intervals` row in
production, and the sessions all survived, so nothing looked wrong until someone
opened a session and found it empty. `PRAGMA defer_foreign_keys` is not a fix
either — it defers violation _checking_, not the cascade.

Rebuilding a table that anything references means carrying the children across
by hand, as `0005_watch_sync_schema.sql` now does:

```sql
CREATE TABLE `__carry_x` AS SELECT * FROM `x`;   -- before the DROP
-- ... rebuild the parent ...
INSERT INTO `x` SELECT * FROM `__carry_x`;       -- after the RENAME
DROP TABLE `__carry_x`;
```

Order matters: create the carry table before the parent is dropped, and refill
before any `ALTER TABLE x ADD COLUMN` in the same migration, or the column counts
won't line up.

**Test any rebuild against a database with rows in it.** A migration that runs
clean on an empty database proves nothing — every test database here starts
empty, so the suite passing is not evidence. Seed a parent and a child, apply the
migration, and count the children afterwards.
