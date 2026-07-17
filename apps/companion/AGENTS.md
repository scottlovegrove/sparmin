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
- **`resetUsers()`** — wipe `sessions` + `user` between tests (cascades clean;
  `stations` seed data survives). Use as `beforeEach(resetUsers)`.
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
