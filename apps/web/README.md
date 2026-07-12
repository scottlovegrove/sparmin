# @sparmin/web

The Sparmin marketing site: one page explaining the watch app (what it is,
screenshots, FAQ, support via GitHub issues) plus a changelog page. Built with
[Astro](https://astro.build), statically rendered, deployed to GitHub Pages.

## Develop

From the repo root (npm workspaces — no need to `cd` in):

```sh
npm install          # once
npm run dev:web      # dev server at http://localhost:4321/sparmin
npm run build:web    # type-check (astro check) + static build → apps/web/dist
npm run preview:web  # serve the built output
```

## Checks

Lint is [oxlint](https://oxc.rs), formatting is oxfmt, types are `astro check` —
the same toolchain and config style as the ShiftSync monorepo. Config lives at
the repo root (`.oxlintrc.json`, `.oxfmtrc.json`); `apps/watch` is excluded from
both, being Monkey C.

```sh
npm run check -w @sparmin/web             # lint + format check
npm run fix -w @sparmin/web               # apply both
npm run type-check -w @sparmin/web        # astro check
npm run integrity-check -w @sparmin/web   # clean + check + type-check + build
```

`integrity-check` is what CI runs (`.github/workflows/web-ci.yml`, on every PR
touching the site), so run it before pushing and it should not surprise you.

## Layout

```
src/
├─ pages/index.astro          The single marketing page (hero, screenshots, features, FAQ, support)
├─ pages/changelog.astro      Renders every release in src/content/changelog/
├─ content/changelog/*.md     One Markdown file per release — this is the changelog
├─ content.config.ts          Schema for those files (version, optional date, summary)
├─ layouts/Base.astro         Page shell: head, header, nav, footer
├─ styles/global.css          Everything global; per-page styles live in the .astro files
└─ assets/screenshots/        Watch screenshots, optimised at build time by <Image>
```

The screenshots are copies of the Connect IQ Store set in
`apps/watch/submission/screenshots/` — copies, not imports, so the two
workspaces stay independent. Re-copy them when the store set is refreshed.

## Adding a release to the changelog

Drop a new file in `src/content/changelog/`, named after the version:

```markdown
---
version: 1.1.0
date: 2026-08-01 # omit while unreleased — it then sorts first and reads "Unreleased"
summary: One line on what this release is about.
---

- What changed.
```

## Deployment

`.github/workflows/deploy-web.yml` builds and publishes to GitHub Pages on every
push to `main` that touches `apps/web`. In the repo's **Settings → Pages**, the
source must be set to **GitHub Actions**.

The site is served from a project page, so `astro.config.mjs` sets
`base: '/sparmin'` and every internal link is built from
`import.meta.env.BASE_URL`. To move to a custom domain: set `base: '/'` and
`site` to the domain, add `public/CNAME` containing the domain, and point a DNS
CNAME at `scottlovegrove.github.io`.
