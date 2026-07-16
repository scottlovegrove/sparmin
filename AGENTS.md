# Sparmin — monorepo

This repo is a monorepo. Each app lives under `apps/` and is self-contained;
its own rules/docs live inside its directory. Work in the relevant workspace,
not at the root.

## Workspaces

- **`apps/watch`** — the Garmin Connect IQ watch app (Monkey C). Its rules are
  in [`apps/watch/AGENTS.md`](./apps/watch/AGENTS.md), its map in
  `apps/watch/CODEBASE.md`, its build/run/test guide in `apps/watch/README.md`.
  **Read those before touching the watch app.**
- **`apps/marketing`** — the marketing site and the public changelog, an Astro app
  served from `sparmin.scottlovegrove.co.uk`. Releases live as one Markdown file
  per version in `src/content/changelog/`.
- **`apps/companion`** — the thermal spa session logger: a React + Vite SPA served
  by a Hono Cloudflare Worker with a D1 backend, deployed as one Worker. Its
  build/run guide is in [`apps/companion/README.md`](./apps/companion/README.md);
  the spec and PR plan are in
  [`docs/spa-logger-spec.md`](./docs/spa-logger-spec.md).

## Root rules

- **npm workspaces** glob `apps/*`. The watch app is not a Node project; its
  `package.json` exists only to expose the `build.sh` targets to the root.
- **Keep changes inside one workspace.** Don't add cross-workspace coupling or
  shared root tooling without a reason — the two apps have nothing in common but
  the brand. **The one exception:** a watch release spans both — bumping
  `Version.APP` in `apps/watch/source/Version.mc` must come with a new changelog
  entry in `apps/marketing/src/content/changelog/`. See `apps/watch/AGENTS.md`.
- **Per-workspace docs are authoritative.** When you change the watch app, the
  rules in `apps/watch/AGENTS.md` apply in full and override anything vague here.

## TypeScript conventions

Apply to the TypeScript/Node workspaces (`apps/marketing`, `apps/companion`); the
watch app is Monkey C and has its own rules. These are house style — match them in
new code and when editing nearby.

- **Tooling is OXC.** Lint with `oxlint`, format with `oxfmt`. The config lives at
  the repo root (`.oxlintrc.json`, `.oxfmtrc.json`) — don't add per-workspace
  overrides. Run `npm run check` / `npm run fix` before committing; both must be
  clean. Formatting is not negotiable — never hand-format against oxfmt.
- **`type` over `interface`.** Prefer `type` aliases for data shapes. Reserve
  `interface` for declaration merging (e.g. extending a generated global like
  `cloudflare:test`'s `ProvidedEnv`).
- **No enums.** Use string-literal unions, with a `const` object map when you need
  the runtime values — never TypeScript `enum`.
- **No `any`.** Give everything a real type; take `unknown` at untrusted
  boundaries and narrow. Validate external input with Zod, once, at the edge.
- **Function style.** `function` declarations for named functions and components,
  regardless of length; arrow functions only for anonymous callbacks
  (`map((x) => …)`). Early returns over nested blocks. Small, single-purpose
  functions; if a function takes more than one "config" argument, pass an object.
- **Immutability.** `readonly` for fields that don't change; `as const` for literal
  constants. Prefer non-mutating array/object operations.
- **Naming.** Files and directories **kebab-case** (`app.tsx`, not `App.tsx`);
  PascalCase for types and React components; camelCase for values and functions;
  UPPER_SNAKE_CASE for constants and env vars. Boolean names read as predicates
  (`isLoading`, `hasError`, `canDelete`). Whole words, not abbreviations — bar the
  usual `id`/`url`/`api`/`ctx`/`req`/`res`/`err` and loop `i`/`j`.
- **No barrel files.** Don't add an `index.ts` that only re-exports.
- **Tests.** Vitest, colocated with the unit or under `test/`, Arrange–Act–Assert.
  Add or adjust a test whenever you change behaviour.
- **tsconfig.** A project-references split (app / worker / node, as in `companion`)
  is fine; keep test-only code out of the build output.
