# Nudge — Architecture & Technical Design

## Authorship

Nudge was designed by **Cibran Docampo**. The implementation was built as a collaboration between Cibran and [Claude](https://claude.ai) (Anthropic), an AI assistant, over a series of structured pair-programming sessions.

The product idea, requirements, data model, UX decisions, and deployment environment are Cibran's. Claude handled the bulk of the code generation, guided by Cibran's specifications and reviewed interactively throughout.

---

## Overview

Nudge is a self-hosted personal web application for tracking recurring tasks and sending push notifications when they come due. It runs as a set of Docker containers orchestrated by Docker Compose, designed to live on a Synology NAS.

```
Browser / Mobile
      │  HTTPS
      ▼
  Reverse proxy (DSM / nginx upstream)
      │  HTTP
      ▼
 ┌─────────────────────┐
 │  frontend (nginx)   │  :80
 │  React SPA + SW     │
 └────────┬────────────┘
          │  /api/*  proxy_pass
          ▼
 ┌─────────────────────┐
 │  backend (gunicorn) │  :8000
 │  Django + DRF       │
 └────┬────────────────┘
      │
      ├──► PostgreSQL :5432
      │
      └──► Redis :6379
              │
              ▼
         ┌──────────┐
         │  Celery  │  (worker + beat)
         │  worker  │
         └──────────┘
```

---

## Tech stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | Vite + React | React 18, Vite 5 |
| PWA | Workbox + vite-plugin-pwa | Workbox 7 |
| UI | Custom CSS (no framework) | — |
| i18n | i18next | 23.x |
| Backend | Django + Django REST Framework | Django 5, DRF 3.15 |
| Auth | JWT (simplejwt) | 5.3.x |
| Database | PostgreSQL | 16 |
| Task queue | Celery + Redis | Celery 5.3, Redis 7 |
| Push | Web Push API / VAPID (pywebpush) | 2.x |
| Runtime | Python 3.12, Node 20 | — |
| Testing (backend) | unittest + coverage.py | — |
| Testing (frontend) | Vitest + Testing Library + MSW | Vitest 2.x |
| Linting (backend) | ruff (check + format) | 0.8+ |
| Linting (frontend) | ESLint 9 (flat config) + Prettier | 9.x |
| Deploy | Docker Compose | — |

---

## Backend

### Django project structure

```
backend/
├── nudge/               # Project config (settings, URLs, WSGI)
├── apps/
│   ├── core/            # Health-check endpoint
│   ├── users/           # Custom user model + auth views
│   ├── routines/        # Domain models and API
│   └── notifications/   # Push subscription + Celery tasks
├── entrypoint.sh        # Runs migrations + ensure_admin on startup (collectstatic runs at build time)
└── requirements.txt
```

### Data model

```
User
 ├── timezone (IANA string)
 ├── daily_notification_time (local time)
 └── language (en / es / gl)

Routine
 ├── name, description
 ├── interval_hours
 ├── is_active
 ├── stock → Stock (optional)
 └── stock_usage (units per log)

RoutineEntry
 └── routine, created_at, notes

Stock
 ├── name
 └── lots → [StockLot]  (quantity is computed from lots)

StockLot
 ├── stock
 ├── quantity
 ├── expiry_date (nullable)
 ├── lot_number
 └── created_at
 (auto-deleted via post_save signal when quantity reaches zero)

PushSubscription
 ├── user
 ├── endpoint, p256dh, auth
 └── last_used

NotificationState
 ├── routine
 ├── last_due_notification
 ├── last_reminder
 └── last_daily_notified
```

### Inventory — FEFO

When a routine is logged, stock is decremented using FEFO (First Expired, First Out): lots are consumed in ascending `expiry_date` order (`NULL` expiry dates are treated as furthest in the future). Each lot is decremented partially until the required `stock_usage` units are satisfied across as many lots as needed.

### Timezone handling

Users set their `daily_notification_time` as a **local time**. The Celery beat task runs every 5 minutes and, for each user, converts their local time to UTC using their IANA `timezone` string before comparing against the current UTC time. This ensures the notification fires at the correct local time year-round, including across DST transitions.

### Notification pipeline

Celery beat runs `check_notifications` every 5 minutes. For each active routine of each active user it evaluates three independent checks:

| Check | Fires when | Cooldown |
|-------|-----------|---------|
| Daily heads-up | Routine has something due today, within ±5 min of user's daily time | Once per calendar day |
| Due notification | Routine has just become overdue | Once per due cycle |
| Reminder | Routine still overdue | Every 8 hours |

`NotificationState` tracks the last send time for each type, preventing duplicates.

Additionally, `send_scheduled_test` is a one-off Celery task (not periodic) that sends a test push notification to a given user. It is enqueued via `POST /api/push/test/scheduled/` with a 5-minute countdown, allowing verification that the full Celery → Redis → Web Push pipeline is working.

### Authentication

Username + password login returns a JWT access token and a refresh token (simplejwt). Tokens are stored in `localStorage` — acceptable for a private, personal instance. The API client automatically refreshes the access token on 401 and retries the original request.

### REST API — key endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/token/` | Login |
| POST | `/api/auth/refresh/` | Refresh JWT |
| GET | `/api/auth/me/` | Current user |
| GET | `/api/dashboard/` | Due + upcoming routines |
| GET/POST/PATCH/DELETE | `/api/routines/` | Routine CRUD |
| POST | `/api/routines/{id}/log/` | Log completion (decrements stock) |
| GET | `/api/routines/{id}/entries/` | Completion history |
| GET | `/api/entries/` | Global history |
| GET/POST/PATCH/DELETE | `/api/stock/` | Inventory CRUD |
| POST/PATCH/DELETE | `/api/stock/{id}/lots/` | Lot management |
| POST | `/api/push/subscribe/` | Register push endpoint |
| DELETE | `/api/push/unsubscribe/` | Remove push endpoint |
| POST | `/api/push/test/` | Send instant test notification |
| POST | `/api/push/test/scheduled/` | Schedule test notification via Celery (5 min) |
| GET | `/api/push/vapid-public-key/` | VAPID public key |

---

## Frontend

### Pages

| Route | Page | Description |
|-------|------|-------------|
| `/login` | LoginPage | Credential form, stores JWT |
| `/` | DashboardPage | Due + upcoming routines at a glance |
| `/routines/new` | RoutineFormPage | Create routine |
| `/routines/:id` | RoutineDetailPage | Detail, history, edit/delete |
| `/routines/:id/edit` | RoutineFormPage | Edit existing routine |
| `/history` | HistoryPage | Paginated global completion log |
| `/inventory` | InventoryPage | Stock + lot management |
| `/settings` | SettingsPage | Language, timezone, notification time |

### PWA

The Service Worker (`src/sw.js`) handles:

- **Precaching** — Workbox caches all Vite-built assets at install time. The app works offline (read-only) after first load.
- **Push events** — Receives payloads from the backend and shows browser notifications with action buttons (`mark-done`, `dismiss`).
- **Notification clicks** — Opens `/routines/{id}` or `/` depending on the action.

The Web App Manifest (`public/manifest.json`) enables home-screen installation on iOS and Android.

### i18n

Three languages: English (`en`), Spanish (`es`), Galician (`gl`). Language is auto-detected from the browser and can be overridden in Settings. All UI strings live in `src/i18n/{en,es,gl}.json`.

---

## Offline pipeline

Every mutation the user triggers can fail because the network is missing, captive, or in a weird proxy state. Nudge never drops one: the request either succeeds against the backend, or it is captured in an IndexedDB queue, replayed when reachability recovers, and — if the server rejects the replay with a 412 — surfaced to the user as a resolvable conflict.

```
   UI tap ── useOfflineMutation ──▶ api.fetch
                │                     │
     on OfflineError │                │ on 2xx
                ▼                     ▼
       enqueue(entry, status='pending')   onSuccess (cache reconciliation)
                │
                │ online again + /api/health/ 2xx
                ▼
        sync.js drains queue (backoff 2s → 10s → 30s)
                │
    ┌───────────┼───────────────────────┐
    │           │                       │
    ▼           ▼                       ▼
 2xx ok   412 conflict             5xx / 429 / retryable
    │         │                         │
 remove     mark 'conflict'        mark 'error' / retry later
            │
            ▼
    ConflictOrchestrator → ConflictModal
            │
    ┌───────┴───────┐
    ▼               ▼
 Overwrite       Discard
 (re-enqueue     (remove +
  with new        invalidate
  updated_at)     queries)
```

### Mutation queue (IndexedDB)

`frontend/src/offline/queue.js` wraps a single object store `mutations` inside the `nudge-offline` IndexedDB database, addressed via `idb-keyval`. Each entry represents one mutation:

| Field | Type | Purpose |
|-------|------|---------|
| `id` | string (UUID) | `Idempotency-Key` header reused verbatim on every retry — at-most-once replay |
| `method` | `POST`/`PATCH`/`PUT`/`DELETE` | HTTP verb |
| `endpoint` | string | API path relative to `/api/` |
| `body` | any or `null` | JSON payload sent on the request |
| `resourceKey` | string or `null` | Scope tag (`routine:5`, `stock:3:lot:7`) used by the `SyncStatusBadge` to colour the right row |
| `ifUnmodifiedSince` | ISO timestamp or `null` | Forwarded as `If-Unmodified-Since` for optimistic locking |
| `createdAt` | ISO timestamp | Tap time, used as tie-breaker when draining |
| `status` | `pending` / `syncing` / `error` / `conflict` | Drives the UI badges and the orchestrator |
| `retryCount` | number | Incremented on each failed replay |
| `nextAttemptAt` | ISO timestamp or `null` | Backoff deadline — the worker skips entries whose attempt is still in the future |
| `conflictCurrent` | any (only when `status='conflict'`) | Server's `current` resource serialisation, used to render the diff |

`useOfflineMutation` is the only producer. Consumers (`useQueueEntries`, `PendingBadge`, `SyncStatusBadge`, `ConflictOrchestrator`) subscribe to a native `EventTarget` that emits `change` on every write, so the UI reacts without polling. Cross-tab synchronisation is out of scope — we assume one active tab per user.

`queueable: false` is the escape hatch for mutations that must NOT queue: settings save, password change, push subscribe/unsubscribe. On `OfflineError` they re-throw so the caller can render a *Requires connection* prompt instead of silently enqueueing.

### Sync worker

`frontend/src/offline/sync.js` drains the queue in `createdAt` order. Triggers:

- Native `online` browser event.
- Service Worker `sync` event (Background Sync API in Chromium). The SW posts a `PROCESS_QUEUE` message to every open client — draining always runs in the main thread so it has the auth context.
- Explicit `forceSync()` called by the reachability module the moment the health poll recovers.

Per entry the worker:

1. Marks `status='syncing'`, registers an `AbortController` against the entry id so the UI can cancel it mid-flight (used by `ConflictModal`'s *Discard* path).
2. Re-issues the exact request body with the original `Idempotency-Key` header.
3. On 2xx — `remove(id)` and **focal invalidation**: only the cache keys that `resourceKey` identifies get invalidated, not the whole React Query store.
4. On 412 — `status='conflict'`, `conflictCurrent=response.body.current`. The orchestrator takes over.
5. On 5xx / 429 / network error — `retryCount++`, `nextAttemptAt = now + backoff[retryCount]` where `backoff = [2s, 10s, 30s]`. After the last step retries are attempted at the longest delay. Override in dev via `window.__NUDGE_SYNC_RETRY_DELAYS_MS__`.
6. On 4xx (non-conflict) — `status='error'`. The entry lives in the `PendingBadge` panel; the user decides to retry or discard.

A per-entry discard aborts the in-flight fetch and removes the queue row. If discard arrives while the request is mid-flight we deliberately leak the server write — correctness from the user's perspective is that they asked to throw it away.

### Reachability probe

`frontend/src/offline/reachability.js` owns the single source of truth for "can we talk to the backend right now?". `navigator.onLine` is not trusted: captive portals answer the L3 ping and a crashed backend still has the OS reporting online.

- On any fetch failure the api client calls `setReachable(false)`. That starts a poll of `GET /api/health/` every `HEALTH_POLL_INTERVAL_MS` (default 20 000 ms).
- On the first 2xx response the module flips back, fires `forceSync()`, and stops the poll.
- A native `offline` DOM event is folded in as a lower-bound — when the OS knows there's no network, we skip the poll and mark offline immediately.

Dev / E2E hooks exposed on `window` (stripped by Rollup in production via `import.meta.env.DEV || VITE_E2E_MODE === 'true'`):

| Hook | Purpose |
|------|---------|
| `__NUDGE_REACHABILITY_SET__(bool)` | Flip the flag directly, bypassing the poll |
| `__NUDGE_REACHABILITY_POLL_MS__` | Override the poll interval (tests use 500 ms) |
| `__NUDGE_REACHABILITY_LOCK__` | `true` blocks passive state flips (SW-cached 200s, api-client success) so tests keep a deterministic offline state |
| `__NUDGE_SYNC_RETRY_DELAYS_MS__` | Replace the `[2s, 10s, 30s]` backoff with a test-friendly array |

The `OfflineBanner` component reads `getReachable()` + subscribes to changes; it is mounted once in `Layout.jsx` and renders across the whole app.

### Conflict resolution (412)

The `OptimisticLockingMixin` in `apps/core/mixins.py` inspects `If-Unmodified-Since` on every `PATCH`/`PUT`/`DELETE`. If the header's timestamp is older than the target row's `updated_at` (at 1-second resolution), the response is `412 Precondition Failed` with:

```json
{
  "error": "conflict",
  "current": { …serialised resource… }
}
```

Migrations `routines/0009` and `routines/0010` add `updated_at` to `RoutineEntry` and `StockConsumption`; `users/0003` adds `settings_updated_at` to `User`. Resources that already had `updated_at` (Routine, Stock, StockLot) are locked via that field directly.

Important: the `ConflictOrchestrator` only opens the modal when a 412 arrives during a **queue-driven replay**. An online 412 (user edits while reachable) throws `ConflictError` from `useOfflineMutation` and bubbles to the caller, which handles the error locally (toast, form error). This keeps the modal focused on the genuinely asynchronous case where the user's tap has already moved on.

`ConflictModal` renders a per-field diff produced by `frontend/src/utils/diffPayloads.js`: only fields that actually differ between the local body and `conflictCurrent` are shown, so the user sees exactly what changed. Two resolutions:

- **Overwrite with my version** — re-enqueue the same body with a new `Idempotency-Key` and the server's fresh `updated_at`. The new key is mandatory: the old key's response is cached as a 412 in the backend's `IdempotencyRecord` and reusing it would just replay the conflict.
- **Discard my changes** — `remove(id)` + invalidate every query key — the server's state is the truth from here on.

### Idempotency middleware

`apps/idempotency/middleware.py` scopes cached responses by `(user, Idempotency-Key)` so the sync worker's retries are safe: if the original request reached the backend but the response never made it back to the client, the replay returns the cached response instead of executing the view again.

- Scope: mutations (`POST`/`PATCH`/`PUT`/`DELETE`) on paths starting with `/api/`. GETs pass through.
- Key length limit 64 characters; oversized or missing headers are silently skipped.
- Body hash is compared against the stored one — replaying with a mutated body returns 422 to surface the misuse.
- 2xx and 4xx responses are both cached; 5xx is not (the retry might succeed).
- TTL 24 hours, enforced by `apps.idempotency.tasks.cleanup_idempotency_records` on the Celery beat schedule.

### See also

- Source files: `frontend/src/hooks/useOfflineMutation.js`, `frontend/src/offline/queue.js`, `frontend/src/offline/sync.js`, `frontend/src/offline/reachability.js`, `frontend/src/components/ConflictModal.jsx`, `frontend/src/components/ConflictOrchestrator.jsx`, `frontend/src/utils/diffPayloads.js`, `backend/apps/core/mixins.py`, `backend/apps/idempotency/middleware.py`.
- E2E coverage: `e2e/tests/offline-read.spec.js`, `e2e/tests/offline-mutations.spec.js`, `e2e/tests/offline-sync.spec.js`.

---

## Docker setup

### Production (`docker-compose.yml`)

Five containers on a shared bridge network (`nudge_net`):

| Service | Image | Exposed port |
|---------|-------|-------------|
| db | postgres:16-alpine | — (internal only) |
| redis | redis:7-alpine | — (internal only) |
| backend | `./backend` Dockerfile | — (internal :8000) |
| celery | `./backend` Dockerfile | — |
| frontend | `./frontend` Dockerfile (multi-stage) | 80 |

The frontend Dockerfile is multi-stage:
1. **builder** — Node 20, runs `npm run build`, produces `dist/`
2. **prod** — nginx:alpine, serves `dist/` and proxies `/api/` to `backend:8000`

The backend Dockerfile uses Python 3.12-slim with a non-root user (`appuser`, uid 1001). `collectstatic` runs at image build time (baked into the image). The entrypoint runs `migrate` and `ensure_admin` before handing off to Gunicorn.

### Development (`dev/docker-compose.yml`)

Identical services but with **bind mounts** (`../backend:/app`, `../frontend:/app`) instead of COPY builds. Live reloading works out of the box — Django's `runserver` and Vite's dev server both watch the mounted source trees.

Exposed to localhost:

| Service | Port |
|---------|------|
| PostgreSQL | 5432 |
| Redis | 6379 |
| Django runserver | 8000 |
| Vite dev server | 5173 |

---

## Testing

### Backend

- **Framework**: Django's built-in `unittest` + `coverage.py`
- **Coverage**: 99%
- **Run**: `docker compose -f dev/docker-compose.yml exec backend python manage.py test`

### Frontend

- **Framework**: Vitest + React Testing Library + MSW (Mock Service Worker)
- **Coverage**: ≥90% (enforced via thresholds in `vitest.config.js`)
- **Run**: `docker compose -f dev/docker-compose.yml exec frontend npm test`
- **With coverage**: `docker compose -f dev/docker-compose.yml exec frontend npm run test:coverage`

---

## Linting & formatting

### Backend — ruff

[ruff](https://docs.astral.sh/ruff/) handles both linting and formatting. Configuration lives in `backend/pyproject.toml`:

- Line length: 120
- Rules: `E` (pycodestyle errors), `F` (pyflakes), `W` (warnings), `I` (isort)
- Migrations are excluded from line-length checks

```bash
docker compose -f dev/docker-compose.yml exec backend ruff check .
docker compose -f dev/docker-compose.yml exec backend ruff format --check .
```

### Frontend — ESLint 9 + Prettier

ESLint 9 with flat config (`frontend/eslint.config.js`):

- Plugins: `react-hooks` (recommended rules), `react-refresh`
- Browser globals enabled

Prettier handles code formatting (configured in `frontend/.prettierrc`).

```bash
docker compose -f dev/docker-compose.yml exec frontend npx eslint src/
docker compose -f dev/docker-compose.yml exec frontend npm run format:check
```

### Pre-commit hook

A git pre-commit hook runs ruff, ESLint, and Prettier inside the dev Docker containers, blocking the commit if any check fails.

```bash
bash scripts/install-hooks.sh   # one-time setup
```

---

## CI / CD

### `ci.yml` — runs on every push to `main`, every PR, and on release

1. **test-backend** — Python 3.12, spins up PostgreSQL 16 + Redis 7 as services, runs ruff (check + format), then `python manage.py test` with coverage. Uploads report to Codecov (flag: `backend`).
2. **test-frontend** — Node 20, runs ESLint (`--max-warnings 0`), Prettier check, then `npm run test:coverage`. Uploads coverage to Codecov (flag: `frontend`).
3. **build-backend** — Docker multi-arch build (`linux/amd64` + `linux/arm64`), pushed to `cibrandocampo/nudge-backend`. Requires both test jobs to pass.
4. **build-frontend** — Same, pushed to `cibrandocampo/nudge-frontend`.

Tags: `latest` on main, `stable` + `vX.Y.Z` on release.

### `weekly-rebuild.yml` — runs every Monday at 06:00 UTC

Rebuilds both images from scratch (`no-cache: true`) to pick up upstream base-image
security patches and `~=`-compatible dependency upgrades. No tests are run because
the code itself hasn't changed — only transitive dependencies get updated. The CI
pipeline already gates every code change with the full lint + test suite.

---

## Dependency versioning strategy

- **Python** (`requirements.txt`): `~=X.Y` compatible release specifier. Allows patch upgrades (e.g., `~=5.0` accepts `5.0.1`, `5.0.2` but not `5.1`).
- **npm** (`package.json`): `~X.Y` tilde prefix. Allows patch-only upgrades within the same minor version (e.g., `~18.3` accepts `18.3.5` but not `18.4.0`).

The weekly rebuild picks up whatever patch versions are available at build time.

---

## Key architectural decisions

| Decision | Rationale |
|----------|-----------|
| JWT in localStorage | Acceptable risk for a private, personal instance with no sensitive financial data |
| Celery beat (5 min) over cron | Simpler deployment (single container), sub-minute precision not needed. See note below on scaling. |
| NotificationState model | Prevents duplicate pushes without requiring atomic distributed locks |
| FEFO for stock | Reduces waste by consuming soonest-to-expire lots first; `NULL` expiry treated as ∞ |
| No external UI framework | Minimal bundle size for a PWA; the app is content-light |
| Django Admin for user management | No need to build admin UI; scope is small (~10 users) |
| Monorepo | Simplifies Docker build context passing and keeps CI straightforward |

---

## Security notes

### CORS

CORS is configured via the `CORS_ALLOWED_ORIGINS` environment variable (comma-separated
list of allowed origins). There is **no wildcard option** — origins must always be
whitelisted explicitly.

In development (`DEBUG=True`) the allowed origins are hardcoded to
`http://localhost:5173` and `http://127.0.0.1:5173`.

In production, set `CORS_ALLOWED_ORIGINS` in your `.env` to match the domain the
frontend is served from (e.g. `https://nudge.naseira.es`).

### Celery worker + Beat

The production compose runs a **single Celery container** with the `-B` flag, which
embeds the Beat scheduler inside the worker process. This is intentional: the project
targets fewer than 100 users, and the periodic tasks (`check_notifications`) are
lightweight and near-atomic, so a dedicated Beat container adds complexity without
meaningful benefit.

If the project were to scale beyond ~1 000 users, it would be advisable to **separate
Beat into its own container** (`celery -A nudge beat`) and run one or more workers
without the `-B` flag. This avoids duplicate task scheduling when running multiple
workers and ensures the scheduler survives independently of worker restarts.

### Security headers

The application is designed to run behind a reverse proxy (e.g. Synology DSM's nginx,
Traefik, Caddy) that handles HTTPS termination and security headers.

If the app is deployed **without** a reverse proxy, the following headers should be
added to `frontend/nginx.conf` inside the `server` block:

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

### VAPID keys

The VAPID keys (`VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`) are read from environment
variables and passed directly to `pywebpush`. If the keys are present but malformed,
push notifications will fail silently at runtime.

For a more defensive setup, consider adding startup validation in `settings.py` (e.g.
checking Base64url length and format). This is not currently implemented because the
keys are set once during initial deployment and rarely change.

### Scaling considerations

The current schema has no composite indexes beyond Django's defaults. With fewer than
100 users this is fine — PostgreSQL's planner prefers sequential scans on small tables.

If the project scales beyond ~1 000 users, consider adding:

```python
class Meta:
    indexes = [
        models.Index(fields=['user', 'is_active'], name='routine_user_active_idx'),
    ]
```

This would speed up the `check_notifications` task, which filters
`Routine.objects.filter(user=..., is_active=True)` for every active user.
