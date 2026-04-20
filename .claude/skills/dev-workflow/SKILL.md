---
name: dev-workflow
description: Development workflow and Docker commands for Nudge. Use when setting up the environment, debugging containers, running Django management commands, or installing dependencies. Triggers when the user asks about development setup, Docker, or environment issues.
---

# Development Workflow — Nudge

## Golden Rule

**NEVER run Python, Node, or npm directly on the host.**
Always use `dev/docker-compose.yml` — it uses bind mounts so local file changes
are reflected instantly without rebuilding.

The root `docker-compose.yml` is for **production** (uses COPY, not bind mounts).

## Start / Stop

```bash
docker compose -f dev/docker-compose.yml --env-file .env up -d      # Start all services
docker compose -f dev/docker-compose.yml --env-file .env down         # Stop all
docker compose -f dev/docker-compose.yml --env-file .env restart frontend  # Restart one service
```

## Services

| Service    | Port  | Purpose                        |
|------------|-------|--------------------------------|
| `backend`  | 8000  | Django dev server              |
| `frontend` | 5173  | Vite dev server (proxies /api) |
| `db`       | 5432  | PostgreSQL                     |
| `redis`    | 6379  | Celery broker                  |
| `celery`   | —     | Celery worker + beat           |

## Common commands

```bash
# Django
docker compose -f dev/docker-compose.yml --env-file .env exec backend python manage.py shell
docker compose -f dev/docker-compose.yml --env-file .env exec backend python manage.py makemigrations
docker compose -f dev/docker-compose.yml --env-file .env exec backend python manage.py migrate
docker compose -f dev/docker-compose.yml --env-file .env exec backend python manage.py createsuperuser

# Tests — backend
docker compose -f dev/docker-compose.yml --env-file .env exec backend python manage.py test                              # full suite
docker compose -f dev/docker-compose.yml --env-file .env exec backend python manage.py test apps.users                   # one app
docker compose -f dev/docker-compose.yml --env-file .env exec backend python manage.py test apps.users.tests.AdminAccessTest  # one class

# Tests — frontend
docker compose -f dev/docker-compose.yml --env-file .env exec frontend npx vitest run                                   # full suite
docker compose -f dev/docker-compose.yml --env-file .env exec frontend npx vitest run src/pages/__tests__/SettingsPage.test.jsx  # one file

# Frontend
docker compose -f dev/docker-compose.yml --env-file .env exec frontend npm install
docker compose -f dev/docker-compose.yml --env-file .env exec frontend npm run build

# Formatting (needed before commits)
docker compose -f dev/docker-compose.yml --env-file .env exec backend ruff format .
docker compose -f dev/docker-compose.yml --env-file .env exec frontend npm run format

# Logs
docker compose -f dev/docker-compose.yml --env-file .env logs backend --tail=50
docker compose -f dev/docker-compose.yml --env-file .env logs celery --tail=50
```

## Vite proxy

The frontend Vite dev server proxies API calls to the backend inside Docker:

```js
proxy: {
  '/api':           { target: 'http://backend:8000' },
  '/admin':         { target: 'http://backend:8000' },
  '/django-static': { target: 'http://backend:8000' },
}
```

`backend` resolves within the Docker network. From the host browser,
access everything through `http://localhost:5173`.

## Quick API verification

To test that endpoints respond correctly from the host:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/health/        # 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/routines/       # 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/auth/token/     # 405 (GET on POST-only)
```

## Service Worker in dev

VitePWA is configured with `devOptions.enabled: true` so the SW registers in dev.
This is needed for push notification testing. The dev SW is served at
`/dev-sw.js?dev-sw` (different from production's `/sw.js`).
After changing `vite.config.js`, restart the frontend container.

## E2E tests (Playwright — Docker, NOT host)

Playwright runs in its own Docker image (`e2e/Dockerfile`). Use `--network host` so
the container can reach `localhost:5173` (frontend) and `localhost:8000` (backend).
Requires the full dev stack running first.

**Build image** (only once, or after changing e2e/package.json):
```bash
docker build -f e2e/Dockerfile -t nudge-e2e ./e2e
```

**Run all tests:**
```bash
docker run --rm --network host \
  -e E2E_USERNAME=admin \
  -e E2E_PASSWORD=<password> \
  -e BASE_URL=http://localhost:5173 \
  nudge-e2e npx playwright test
```

The password is in `.env` as `ADMIN_PASSWORD`.

## E2E seed (auto)

`npx playwright test` calls `POST /api/internal/e2e-seed/` via
`globalSetup` (`e2e/global-setup.js`). Wipes the DB (except admin) and
rebuilds a deterministic fixture (T073):

- 3 users: `user1 / user2 / user3` (mutual contacts).
- 7 routines owned by `user1`, covering the 6 state combinations +
  one blocked by depleted stock:
  `Take vitamins`, `Morning stretch`, `Weekly cleaning`,
  `Water filter`, `Vitamin D supplement`, `Medication`, `Pain relief`.
- 5 stocks with varied lot distribution (incl. one `Vitamin D` lot
  without `lot_number` for dedup tests, and `Ibuprofen` with
  `quantity=0` for the blocked-completion test).
- ~91 routine entries + 6 stock consumptions over the last 60 days,
  concentrated in 2–3 routines to stress History pagination.

Required env vars:
- `E2E_SEED_ALLOWED=true` (or `DJANGO_DEBUG=True`)
- `E2E_USER1_PASSWORD`, `E2E_USER2_PASSWORD`, `E2E_USER3_PASSWORD`
- `E2E_USERNAME=admin` + `E2E_PASSWORD=<admin password>` for specs
  that log in as admin.

All test users and canonical names are exported from
`e2e/tests/helpers.js` as the `SEED` constant. Import from there,
never hardcode.

## E2E offline helpers (T068)

`e2e/tests/helpers.js` (via `helpers/offline.js`) exposes helpers for
offline / reachability / conflict flows:

- `goOffline(page, context)` / `goOnline(page, context)` — toggle the
  network and force the reachability flag so the `OfflineBanner`
  reacts immediately (poll interval shortened to 500 ms).
- `waitForServiceWorkerReady(page)` — block until
  `navigator.serviceWorker.controller` is set.
- `expectOfflineBanner(page, { visible })` / `expectPendingBadge(page, { count })` —
  asserts by `data-testid` + `data-count`.
- `waitForSyncDrain(page, { timeout })` — waits for the pending badge
  to disappear (queue drained).
- `mockApiRoute(page, { method, urlPattern, status, body, times })` —
  `page.route()` wrapper with a "respond N times then fall through"
  mode, used for 412 / 429 / 5xx simulations. Returns an async
  cleanup function.
- `openConflictOnRoutineRename(page, routineId)` — leaves the test
  with the `ConflictModal` open via a mocked 412 on PATCH. Returns
  the mock cleanup so the caller can replay the mutation against the
  real backend.

The components `OfflineBanner`, `PendingBadge`, `SyncStatusBadge` and
`ConflictModal` expose stable `data-testid` / `data-count` /
`data-state` attributes. Prefer these selectors over i18n text or CSS
class matches.

In dev mode, `window.__NUDGE_REACHABILITY_SET__` and
`window.__NUDGE_REACHABILITY_POLL_MS__` are exposed so specs can drive
reachability directly without relying on `fetch` side effects. They
are stripped by the production build (`import.meta.env.DEV` guard),
but the `frontend-preview` service opts back in via `VITE_E2E_MODE=true`.

## E2E preview build (T069)

The Vite dev server does NOT precache JS modules in the Service Worker
(`__WB_MANIFEST` is empty in dev), so offline reloads can't load the
React app against `:5173`. Offline specs (`offline-*.spec.js`) run
against a production preview build served by the `frontend-preview`
service on port `4173`.

Bring it up before running offline tests:

```bash
docker compose -f dev/docker-compose.yml --env-file .env \
  --profile preview up -d frontend-preview
# First boot runs `npm run build` (~30 s). Subsequent boots are fast.
```

`playwright.config.js` has two projects that Playwright runs together:

- `chromium-dev` at `localhost:5173` — runs every spec except
  `offline-*.spec.js`.
- `chromium-preview` at `localhost:4173` — runs only `offline-*.spec.js`.

Run subsets:
- `npx playwright test --project=chromium-dev` — dev specs only.
- `npx playwright test --project=chromium-preview` — offline specs only.
- `npx playwright test` — all, dispatched to the right project automatically.

## E2E — estado actual (T072)

- **Total tests**: 84 across 20 spec files — `chromium-dev` runs 73
  (auth, admin, dashboard, inventory, routines, settings, history,
  sharing, unshare, contacts, i18n, routine-completion, stock-expiry,
  stock-share-grouped-bug, scheduled-push, push-realtime, helpers
  smoke) and `chromium-preview` runs 11 (`offline-read`,
  `offline-mutations`, `offline-sync`).
- **Tiempo típico**: ~1.4 min por corrida (3 corridas de T072:
  87s / 88s / 92s). Budget interno: < 12 min.
- **Workers**: 1 (`workers: 1`, `fullyParallel: false`) — dev y
  preview comparten el mismo backend y en paralelo pisan datos.
- **Retries**: 1 por defecto en `playwright.config.js`; los validation
  runs usan `--retries=0`. Cualquier flake bajo `--retries=0`
  cuenta como fallo real y hay que diagnosticar en origen.
- **Stack prerequisite**: `docker compose -f dev/docker-compose.yml --env-file .env up -d`
  (backend, celery, frontend) más `--profile preview up -d frontend-preview`
  si vas a correr offline specs.
- **Seed**: automático via `globalSetup`; BD y `PushSubscription.objects`
  se resetean entre specs con `await resetSeed(context)` en beforeEach
  cuando el spec muta datos globales.

**Subsets rápidos**:

```bash
# Auth + admin (sanity)
npx playwright test auth admin

# Solo offline (requiere frontend-preview arriba)
npx playwright test --project=chromium-preview

# Un spec aislado, sin retries (para reproducir un flake)
npx playwright test tests/push-realtime.spec.js --retries=0

# Full suite
npx playwright test
```

## When port 8000 is busy

If another container already binds port 8000, use `run --rm` instead of `exec` — it starts a one-off container without binding host ports:

```bash
docker compose -f dev/docker-compose.yml --env-file .env run --rm backend python manage.py migrate
docker compose -f dev/docker-compose.yml --env-file .env run --rm backend python manage.py shell
```

## Environment variables

All env vars are in `.env` at the project root. Key ones:
- `ADMIN_PASSWORD` — password for the admin user (auto-created on startup)
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — for Web Push
- `DJANGO_SECRET_KEY`, `POSTGRES_*`, etc.
