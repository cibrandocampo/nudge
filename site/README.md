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

This builds the `nudge-e2e` image, launches the Playwright script
against `localhost:5173`, and writes the refreshed PNGs to
`docs/screenshots/`. Next build of the landing picks them up via the
`copy-screenshots.mjs` mirror.

The script also captures the two offline-specific scenes
(`10-offline-banner`, `11-conflict-modal`) via the dev-only
`__NUDGE_REACHABILITY_SET__` hook + a Playwright 412 mock. It must run
against the dev server (or a preview build with `VITE_E2E_MODE=true`),
not a production bundle.

### Marketing screenshots ("How it works" section)

The 3 captures used by the lifecycle storyboard in §3 live in a
separate pipeline with its own seed, script, and Makefile target:

```bash
make screenshots-marketing
```

What it does, in order:

1. Runs `python manage.py seed_marketing` in the dev backend — wipes
   business data and seeds a compact fixture (`alex` + `jordan` users,
   5 stocks, 4 routines, zero history). Same triple gate as
   `seed_e2e`, so **running it wipes your dev database**; it refuses
   to run in production.
2. Builds the `nudge-e2e` image.
3. Runs `e2e/screenshots-marketing.js` inside the container with
   `locale: 'en-US'` forced on the browser context. Writes three PNGs
   to `docs/screenshots/marketing/`:
   - `lifecycle-02-dashboard.png`
   - `lifecycle-03-stock.png`
   - `lifecycle-05-lot-selection.png`

These are mirrored to `public/screenshots/marketing/` by the same
`copy-screenshots.mjs` script (now recurses into subfolders). The
marketing captures are single-sourced from `docs/screenshots/marketing/`
— do not commit anything under `public/screenshots/marketing/`.

**Drift risk**: the captures are regenerated on demand only. A
redesign of the Dashboard, Inventory, or LotSelectionModal silently
invalidates them — re-run `make screenshots-marketing` afterwards.
Steps 1 (install icon) and 4 (OS-style notification) in the landing
are rendered in pure CSS/SVG inside `LifecycleStory.astro`, so they
stay in sync with the app's brand as long as the Nudge icon
(`public/icons/nudge-512.png`) is up to date.

**Password**: the fixture user `alex` uses `MARKETING_USER_PASSWORD`
from `.env` — if unset, both the seed command and the Makefile target
fall back to `marketing-pass`, so the pipeline works out of the box.
