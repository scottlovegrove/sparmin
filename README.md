# Sparmin

Monorepo for **Sparmin** — a Garmin Connect IQ watch app for logging thermal spa
sessions (saunas, cold plunges, pools) as a FIT activity — and its marketing
website.

## Workspaces

| Path         | Package          | What it is                                                        |
| ------------ | ---------------- | ----------------------------------------------------------------- |
| `apps/watch` | `@sparmin/watch` | The Connect IQ watch app (Monkey C). Build/test with `build.sh`.  |
| `apps/web`   | `@sparmin/web`   | Single-page marketing site. Placeholder — not built yet.          |

npm workspaces tie the two together (`apps/*`), but the watch app is **not** a
Node project — its `package.json` only exposes the `build.sh` targets so they
can be driven from the repo root.

## Getting started

Each workspace is self-contained; work inside its directory.

```bash
# Watch app — see apps/watch/README.md for the full build/run/test guide.
cd apps/watch && ./build.sh          # side-load the primary devices
npm run build:watch                  # …or drive it from the repo root
```

Read `apps/watch/README.md` for the watch build/run/test workflow and design
decisions, `apps/watch/AGENTS.md` for the rules when changing that app, and
`apps/watch/CODEBASE.md` for its structural map.
