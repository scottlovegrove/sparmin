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
