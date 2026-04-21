# Landing site

This folder holds the public marketing site for Nudge, served at
[cibrandocampo.github.io/nudge/](https://cibrandocampo.github.io/nudge/).

Stack: **Astro 4 + Tailwind 3**, single-page landing, zero-framework
runtime (a handful of inline `is:inline` scripts for the copy button).
Not a docs site — documentation lives under `docs/` and in the main
`README.md`.

## What this is

- 10 sections: hero, 30-second pitch, lifecycle storyboard ("How it
  works"), offline storyboard, feature grid, screenshots carousel,
  privacy statement, self-host snippet, FAQ, footer.
- Dark mode by default; light kicks in via `prefers-color-scheme`.
- Screenshots are **single-sourced** from `../docs/screenshots/`. A
  prebuild script (`scripts/copy-screenshots.mjs`) mirrors them into
  `public/screenshots/` on every `npm run dev` and `npm run build`.
  The destination is gitignored — do not commit it.

## Run locally

Requirements: Node.js 20+ (match CI). From the repo root:

```bash
cd site
npm install
npm run dev
```

The dev server comes up on `http://localhost:4321/nudge/`. `astro dev`
hot-reloads component and content changes. The prebuild screenshot
mirror runs automatically, so changes to `docs/screenshots/*.png`
show up on the next dev restart (or `npm run dev` again).

## Build

```bash
npm run build
```

Pipeline: `copy-screenshots.mjs` → `astro check` (type-check) →
`astro build`. Output lands in `site/dist/` (gitignored). Preview with
`npm run preview`.

## Deploy

Automated via `.github/workflows/site-deploy.yml`. Triggers:

- every push to `main` — the site redeploys on each merge and stays
  in lock-step with the deployed code;
- every published release — tag-based docs always reflect the
  shipped version;
- manual `workflow_dispatch` when you want to force a rebuild.

The workflow runs `npm ci` + `npm run build` inside `site/`, uploads
`site/dist/` as the Pages artifact, and `actions/deploy-pages@v4`
publishes it.

### One-time setup

Before the first deploy lands publicly, flip the GitHub Pages source
to the new Actions-based pipeline:

1. Open the repo settings → **Pages**.
2. Under **Build and deployment → Source**, select **GitHub Actions**.

After that, every relevant push deploys automatically. Verify with:

```bash
gh api /repos/cibrandocampo/nudge/pages --jq '.build_type, .html_url, .status'
# → "workflow"
# → "https://cibrandocampo.github.io/nudge/"
# → "built"
```

## Editing content

- `src/pages/index.astro` — section order and the data arrays driving
  the landing (`offlineSteps`, `features`, `screenshots`, `faqItems`).
- `src/components/` — reusable pieces. Keep them pure presentational:
  props in, markup out, no fetching.
- `src/layouts/Base.astro` — global `<head>`, OG/Twitter meta, body
  wrapper, gradient background.
- `tailwind.config.mjs` — the `nudge` colour palette and the system
  font stack. Change here if the app rebrands so the landing stays in
  sync.
- `src/styles/global.css` — Tailwind directives + smooth-scroll +
  light-mode overrides. Motion is gated by
  `@media (prefers-reduced-motion)` — keep it that way.

## Regenerating screenshots

From the repo root, with the dev stack running:

```bash
make screenshots
```

Single pipeline: seeds the `seed_demo` fixture (users `cibran` +
`maria`, 6 stocks, 6 routines, 6 entries), builds the `nudge-e2e`
image, and runs `e2e/screenshots.js` against `localhost:5173`
capturing 13 PNGs to `docs/screenshots/` (flat, no subfolders):
`login`, `dashboard`, `dashboard-sharing`, `routine-detail`,
`new-routine`, `inventory`, `stock-detail`, `history`, `settings`,
`shared-dashboard`, `offline-banner`, `conflict-modal`,
`lot-selection`. The next landing build picks them up via the
`copy-screenshots.mjs` mirror.

**Destructive**: `seed_demo` wipes business data on every run. Same
triple gate as `seed_e2e` (`DJANGO_DEBUG=True` OR
`E2E_SEED_ALLOWED=true`) so it refuses to run in production.

The `offline-banner` and `conflict-modal` scenes depend on the
dev-only `__NUDGE_REACHABILITY_SET__` hook + a Playwright 412 mock.
They must run against the dev server (or a preview build with
`VITE_E2E_MODE=true`), not a production bundle.

**Drift risk**: captures are regenerated on demand only. Any
redesign of the app silently invalidates them — re-run
`make screenshots` afterwards. Steps 1 (install icon) and 4 (OS-style
notification) in the landing's lifecycle storyboard are rendered in
pure CSS/SVG inside `LifecycleStory.astro`, so they stay in sync
with the app's brand as long as the Nudge icon
(`public/icons/nudge-512.png`) is up to date.

**Password**: the fixture users share a single password read from
the optional `DEMO_USER_PASSWORD` env var. Unset by default (not in
`.env.example`); both the seed command and the Makefile target fall
back to `demo-pass` so the pipeline works out of the box. See
[`dev/README.md`](../dev/README.md#environment-variables-dev-only) if
you want a custom value.
