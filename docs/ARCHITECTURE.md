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
| Frontend | Vite + React | React 19, Vite 8 |
| PWA | Workbox + vite-plugin-pwa | Workbox 7, vite-plugin-pwa 1.x |
| UI | Custom CSS (no framework) | — |
| i18n | i18next | 26.x |
| Backend | Django + Django REST Framework | Django 5.2 LTS, DRF 3.18 |
| Auth | JWT (simplejwt) | 5.5.x |
| Database | PostgreSQL | 17 |
| Task queue | Celery + Redis | Celery 5.6, Redis 8 (redis-py 6.4) |
| Push | Web Push API / VAPID (pywebpush) | 2.x |
| Runtime | Python 3.13, Node 24 | — |
| Testing (backend) | unittest + coverage.py | — |
| Testing (frontend) | Vitest + Testing Library + MSW | Vitest 4.x |
| Linting (backend) | ruff (check + format) | 0.15+ |
| Linting (frontend) | ESLint 10 (flat config) + Prettier | 10.x |
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
│   ├── notifications/   # Push subscription + Celery tasks
│   └── regulatory/      # Official medicine data (CIMA / AEMPS) linked to stocks
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
 ├── name, gtin, default_lot_quantity
 ├── national_code, national_code_source   (e.g. the Spanish CN; user data)
 ├── presentation → Presentation (nullable, derived from national_code)
 ├── name_offer_pending                     (ask the owner to adopt the official name)
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

Regulatory catalogue (`apps/regulatory`) — agency-neutral tables, holding
**only** what some stock is linked to:

```
Medicine        (source, code)  name, authorized_on / suspended_on / revoked_on, agency_url, leaflet_url, raw
 ├── presentations → [Presentation]
 └── leaflet → MedicineLeaflet  sections [{key, title, html}] (sanitised), source_url, fetched_at
Presentation    (source, code)  name, marketed, supply_severity, fetch_status, fetched_at, raw
 └── supply_problems → [SupplyProblem]  native_type, severity, note, dates, resolved_at
SafetyNotice    (source, reference)  title, url, published_on ←→ medicines (M2M)
RegulatoryEvent presentation, kind (9 kinds), payload (model terms), detected_at
 └── deliveries → [EventDelivery]  user, stock, delivered_at (unique per event + user)
```

### Regulatory data (CIMA / AEMPS)

A stock with a national code is linked to the official record of its medicine.
The data model is generic (a `source` on every row, the agency's own codes next
to normalised values such as `severity`); the code serves one agency today:
`apps/regulatory/clients/aemps.py` is the only module that knows CIMA's URLs
and fields, and it returns the standard shape of `clients/types.py`.

- **Code.** An NTIN (`0847000…`) embeds the Spanish CN; a pack with the
  manufacturer's own GTIN carries it in the scanned AI 712; the owner can also
  type it. The CN's 7th digit is the GS1 check digit of `0847000` + CN.
- **Fetch.** Saving a code links the stock and enqueues `fetch_presentation`
  (Celery, retried with backoff); the user's write never waits for the agency.
  A presentation's first fetch is its baseline (`fetched_at`).
- **Daily refresh.** Beat runs `sync_regulatory_data` at 03:00 UTC (`crontab`):
  relinks stocks with a code, refreshes every linked presentation one by one,
  fetches leaflets that are missing or older than 30 days, prunes rows no
  stock has used for 30 days, and drops deliveries nobody received in 30 days.
- **Leaflet.** Fetched by sections (`fetch_leaflet` task: when a medicine is
  first seen, monthly in the sync, and on "Refresh info"), sanitised once on
  storage with an `nh3` allowlist (`apps/regulatory/sanitize.py`: no styles,
  scripts, handlers or remote images) and stored in its own table, so no list
  query loads it. The product page renders it as an accordion; it is the only
  remote HTML in the app.
- **Change detection.** `apply_presentation` compares the stored state with
  each new answer (supply started / changed / resolved, new safety notice,
  marketing stopped / resumed, authorisation suspended / revoked / reinstated)
  and records a `RegulatoryEvent`, with one `EventDelivery` per user holding
  a stock of that presentation at that moment. A first fetch, or the first
  `ok` after a `not_found`, is a silent baseline; a reworded note is no event.
- **Daily digest.** `check_notifications` sends each user's pending
  deliveries as one push at their `daily_notification_time` (a safety notice
  counted once), then marks them delivered. Its `data` opens the product
  (`stock_id`) or the inventory (`path`); `src/swRouting.js` decides.
- **Inventory.** An active supply problem, a medicine no longer marketed or a
  suspended / revoked authorisation joins the alert banner and the Attention
  filter (`utils/stockAlerts.js`), from the summary on the list — no extra
  request.
- **Switch.** `REGULATORY_FETCH_ENABLED=False` keeps the backend off the
  network (CI, E2E, tests); codes are still validated.
- **Seed.** `seed` applies recorded CIMA answers
  (`apps/regulatory/test_data/aemps/`) through the same parser, offline.
- **Upgrade.** Existing stocks are linked once with `link_regulatory_stocks`
  (see `docs/upgrade.md`).

### Inventory — FEFO

When a routine is logged, stock is decremented using FEFO (First Expired, First Out): lots are consumed in ascending `expiry_date` order (`NULL` expiry dates are treated as furthest in the future). Each lot is decremented partially until the required `stock_usage` units are satisfied across as many lots as needed.

A consumption is all or nothing. `Stock.consume_lots` (used by `POST /api/stock/{id}/consume/` and `POST /api/routines/{id}/log/`) either takes exactly the requested units or raises `InsufficientStock`, which the API returns as `422` with `code: "insufficient_stock"`, `required` and `available`. The method is atomic, so a failure leaves every lot as it was. This applies when FEFO runs out of lots and when an explicit lot selection asks a lot for more than it holds. A selected lot that no longer exists (emptied, and so deleted, after the user picked it) answers `422` with `code: "lot_unavailable"` and its `lot_ids`; a lot of another stock is still a `400`. As a result, the audit rows (`RoutineEntry.consumed_lots`, `StockConsumption`) always add up to the quantity they record. Both request bodies go through `ConsumeInputSerializer` / `LogInputSerializer`: `quantity >= 1`, no repeated `lot_id`, and `lot_selections` null or `[]` means FEFO.

### Timezone handling

Users set their `daily_notification_time` as a **local time**. The Celery beat task runs every 5 minutes and, for each user, converts their local time to UTC using their IANA `timezone` string before comparing against the current UTC time. This ensures the notification fires at the correct local time year-round, including across DST transitions.

### Notification pipeline

Celery beat runs `check_notifications` every 5 minutes. For each active routine of each active user it evaluates three independent checks:

| Check | Fires when | Cooldown |
|-------|-----------|---------|
| Daily heads-up | Routine has something due today, within ±5 min of user's daily time | Once per calendar day |
| Due notification | Routine has just become overdue | Once per due cycle |
| Reminder | Routine still overdue AND `reminder_mode='intensive'` AND recipient not in quiet hours | Every `routine.reminder_interval_minutes` (default 2h; choices 1h/2h/4h/8h) |

`NotificationState` tracks the last send time for each type, preventing duplicates.

Additionally, `send_scheduled_test` is a one-off Celery task (not periodic) that sends a test push notification to a given user. It is enqueued via `POST /api/push/test/scheduled/` with a 5-minute countdown, allowing verification that the full Celery → Redis → Web Push pipeline is working.

### Authentication

Every user carries an `auth_method` field — either `'otp'` or `'password'` — chosen when the account is created. Self-signups default to OTP; admins creating users manually from Django Admin can pick either. The two methods are orthogonal to `is_staff`: any user can have any method.

**Login is a two-step wizard, identical on the frontend regardless of method**:

1. `POST /api/auth/login/start/ { email }` — the backend looks up the user by email and answers with `{ method: 'otp' | 'password' }`. For OTP users (and for self-signups when `ALLOW_SELF_SIGNUP=True`) a 6-digit code is hashed, persisted as a `LoginCode` row, and enqueued for email delivery via Celery. Password users get the method back with no email side-effect.
2. `POST /api/auth/login/verify/ { email, code | password }` — validates the proof and returns `{ access, refresh, is_new }`. `is_new` is true when the user has no `first_name` / `last_name` yet, signalling that the frontend should render the onboarding step (capture name + last name → `PATCH /api/auth/me/`) before the dashboard.

**OTP codes** are 6 digits, expire in 10 minutes, allow 5 attempts. Only the SHA-256 hash is stored. A daily Celery beat task (`cleanup_login_codes`) sweeps rows past their `expires_at`.

**Rate limits**:

- `login/start/`: 10/hour per IP (every hit can send an email) plus a separate 3/hour per email destination (defends against an attacker rotating IPs to spam a single inbox).
- `login/verify/`: 10/minute per IP.

**Self-signup** is gated by the `ALLOW_SELF_SIGNUP` env var (default `False`). When False, unknown emails on `login/start/` return `404 user_not_found`. When True, unknown emails create an `is_active=False` user with `auth_method='otp'` and trigger a welcome email containing the OTP — the first successful verify activates the account.

**Disposable email blocking**: when self-signup is open, registrations from throwaway providers (yopmail, mailinator, guerrillamail, 10minutemail, …) are rejected with `400 disposable_email`. The blocklist lives at `backend/apps/users/disposable_email_domains.txt` — a curated ~80-entry subset of the community-maintained [`disposable-email-domains`](https://github.com/disposable-email-domains/disposable-email-domains) project (CC0-1.0, thanks to its maintainers). It is gated by `BLOCK_DISPOSABLE_EMAIL` (default ON in production, OFF in `DJANGO_DEBUG=True`) and can be extended or trimmed via `DISPOSABLE_EMAIL_EXTRA_DOMAINS` / `DISPOSABLE_EMAIL_ALLOW_DOMAINS`. The check only applies to **new** signups — pre-existing users with such an email keep their account.

**Frontend config probe**: `GET /api/auth/config/` is public and unauthenticated. It returns `{ allow_self_signup: bool }` so `/login` can render "Sign in" or "Sign in or create an account" without baking the flag into the build. The query inherits the global `staleTime: 30s`, so a server-side flip is picked up on the next page load without manual cache invalidation.

**Branding**: outbound emails (welcome + login code) are sent as multipart text/HTML with the Nudge logo embedded as CID. The HTML footer links back to `NUDGE_SITE_URL` (env var); leave it empty to render just "Nudge" without a link. Templates live in `backend/templates/emails/{login_code,welcome_signup}/{en,es,gl}.body.html` and extend a shared `_layout.html`.

**JWT lifetimes**: access tokens last 2 hours, refresh tokens 60 days. Tokens are stored in `localStorage` (acceptable for a self-hosted personal instance). The API client refreshes the access token automatically on 401 and retries the original request. The long refresh window keeps interactive logins infrequent given each one costs an email round-trip for OTP users.

**Username phase-out**: the legacy `username` field still exists on `AbstractUser` as an internal identifier (auto-generated on self-signup from the email local-part with a numeric suffix on collision). The frontend never renders it — display name is "first + last" (helper `getDisplayName(user)`), falling back to email when names are absent.

The legacy endpoint `POST /api/auth/token/` (username + password) is kept operational for the `/admin/` access flow (`admin-access` view trades a JWT for a Django session). The frontend stops using it.

### REST API — key endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/config/` | Public, unauthenticated. Returns `{ allow_self_signup }` so `/login` can adapt its copy |
| POST | `/api/auth/login/start/` | Step 1 of the email-OTP / password wizard — returns `{ method }` |
| POST | `/api/auth/login/verify/` | Step 2 — accepts `{ code }` or `{ password }`, returns `{ access, refresh, is_new }` |
| POST | `/api/auth/token/` | Legacy username+password login (kept for `admin-access`) |
| POST | `/api/auth/refresh/` | Refresh JWT |
| GET / PATCH | `/api/auth/me/` | Current user — PATCH accepts `first_name`/`last_name` for onboarding |
| GET / POST / DELETE | `/api/auth/contacts/` | Contacts — POST adds by exact email match |
| GET | `/api/dashboard/` | Due + upcoming routines |
| GET/POST/PATCH/DELETE | `/api/routines/` | Routine CRUD |
| POST | `/api/routines/{id}/log/` | Log completion (decrements stock) |
| GET | `/api/routines/{id}/entries/` | Completion history |
| GET | `/api/entries/` | Global history |
| GET/POST/PATCH/DELETE | `/api/stock/` | Inventory CRUD |
| POST/PATCH/DELETE | `/api/stock/{id}/lots/` | Lot management |
| GET | `/api/stock/{id}/regulatory/` | Official medicine data: supply problems, safety notices, agency link |
| POST | `/api/stock/{id}/regulatory/refresh/` | Owner: fetch again and re-ask the official-name question (`202`) |
| POST | `/api/stock/{id}/regulatory/name-offer/` | Owner: `{accept}` — adopt or decline the official name |
| GET | `/api/stock/{id}/leaflet/` | Sanitised leaflet sections, `source_url`, `language`; `404` `leaflet_pending` / `no_national_code` |
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
6. On 4xx (non-conflict) — `status='error'`. The entry lives in the `PendingBadge` panel; the user decides to retry or discard. When the response body carries a `code` (e.g. `insufficient_stock`), the entry stores it as `errorMessage` and the body as `errorArgs`. The panel then shows the translated message with the server's numbers (`queueErrorMessage` in `utils/errors.js`) instead of `HTTP <status>`.

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
| db | postgres:17-alpine | — (internal only) |
| redis | redis:8-alpine | — (internal only) |
| backend | `./backend` Dockerfile | — (internal :8000) |
| celery | `./backend` Dockerfile | — |
| frontend | `./frontend` Dockerfile (multi-stage) | 80 |

The frontend Dockerfile is multi-stage:
1. **builder** — Node 24, runs `npm run build`, produces `dist/`
2. **prod** — nginx:alpine, serves `dist/` and proxies `/api/` to `backend:8000`

The backend Dockerfile uses Python 3.13-slim with a non-root user (`appuser`, uid 1001). `collectstatic` runs at image build time (baked into the image). The entrypoint runs `migrate` and `ensure_admin` before handing off to Gunicorn.

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

### Frontend — ESLint 10 + Prettier

ESLint 10 with flat config (`frontend/eslint.config.js`):

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

1. **test-backend** — Python 3.13, spins up PostgreSQL 17 + Redis 8 as services, runs ruff (check + format), then `python manage.py test` with coverage. Uploads report to Codecov (flag: `backend`).
2. **test-frontend** — Node 24, runs ESLint (`--max-warnings 0`), Prettier check, then `npm run test:coverage`. Uploads coverage to Codecov (flag: `frontend`).
3. **build-backend** — Docker multi-arch build (`linux/amd64` + `linux/arm64`), pushed to `cibrandocampo/nudge-backend`. Requires both test jobs to pass.
4. **build-frontend** — Same, pushed to `cibrandocampo/nudge-frontend`.

Tags: `latest` on main, `stable` + `X.Y.Z` on release.

### `weekly-rebuild.yml` — runs every Monday at 06:00 UTC

Rebuilds both images from scratch (`no-cache: true`) to pick up upstream base-image
security patches and `~=`-compatible dependency upgrades. No tests are run because
the code itself hasn't changed — only transitive dependencies get updated. The CI
pipeline already gates every code change with the full lint + test suite.

### `sync-disposable-email-domains.yml` — runs every Monday at 06:30 UTC

Fetches the canonical [`disposable-email-domains`](https://github.com/disposable-email-domains/disposable-email-domains)
blocklist (CC0-1.0) and, if it differs from the bundled
`backend/apps/users/disposable_email_domains.txt`, opens a PR with the
diff. The PR is the only gate: each upstream change is reviewed before
landing on `main`, so builds remain deterministic and an unexpected
upstream commit can't auto-ship to production. The first PR migrates the
bundled file from the curated subset to the full upstream mirror —
subsequent PRs are small diffs against upstream. A sanity check aborts
the sync if the fetched file has fewer than 1000 lines (the real list is
~4500), so a partial / failed fetch can't silently empty the blocklist.

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
| Celery + Redis over APScheduler | See [Celery vs APScheduler](#celery-vs-apscheduler) below. |
| Celery beat (5 min) over cron | Simpler deployment (single container), sub-minute precision not needed. See note below on scaling. |
| NotificationState model | Prevents duplicate pushes without requiring atomic distributed locks |
| FEFO for stock | Reduces waste by consuming soonest-to-expire lots first; `NULL` expiry treated as ∞ |
| No external UI framework | Minimal bundle size for a PWA; the app is content-light |
| Django Admin for user management | No need to build admin UI; scope is small (~10 users) |
| Monorepo | Simplifies Docker build context passing and keeps CI straightforward |

### Celery vs APScheduler

APScheduler was considered as a lighter-weight alternative — it would remove
Redis from the periodic-task path and run the scheduler in-process. We picked
Celery anyway. Reasons, in order of weight:

1. **We need a task queue, not just a scheduler.** Push delivery via
   `pywebpush` is slow, network-bound I/O that fails in interesting ways
   (410 Gone, 429, transient 5xx). Celery gives us per-task retries with
   backoff, acks-late semantics, and configurable worker concurrency out of
   the box. APScheduler only fires jobs — retry, concurrency control and
   dead-lettering would have to be built on top.

2. **Periodic and ad-hoc tasks share one runtime.** Beyond the 5-minute
   `check_notifications` sweep, we already enqueue ad-hoc jobs:
   `send_scheduled_test` (countdown=5min, triggered from `POST
   /api/push/test/scheduled/`) and `cleanup_idempotency_records`. With
   Celery both live in the same worker pool. With APScheduler we'd either
   run scheduled + ad-hoc through two different mechanisms or build our
   own job-submission API.

3. **Process isolation from the web tier.** Celery runs in its own
   container, so a slow push batch can't block gunicorn request handlers.
   APScheduler's `BackgroundScheduler` typically lives inside the Django
   process; running it standalone means writing process management
   ourselves.

4. **Crash recovery via Redis.** Queued tasks survive a worker restart
   because they're held in Redis until acked. APScheduler can persist jobs
   to a SQLAlchemy/Redis jobstore, but it's extra configuration and the
   semantics (especially around missed runs and `coalesce`) are subtler
   than Celery's "the broker holds it until someone acks".

5. **Marginal operational cost.** Redis is a single extra container in the
   compose stack. Given (1)–(4), the tradeoff favours Celery even at our
   small scale. If we ever needed to drop Redis to save resources on the
   NAS, APScheduler would be a reasonable fallback for the periodic side
   — but we'd still need *something* queue-shaped for push retries.

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

The frontend nginx sends its own security headers on everything it serves (the SPA
and its assets): a strict `Content-Security-Policy`, `X-Content-Type-Options`,
`Referrer-Policy`, `X-Frame-Options` and `Permissions-Policy`. They live in
`frontend/nginx-security-headers.conf`, included per location in `nginx.conf` —
not at `server` level, so the `/api/` and `/admin/` proxies keep Django's own headers.
The reverse proxy in front (e.g. Synology DSM's nginx, Traefik, Caddy) still handles
HTTPS termination.

The CSP allows only same-origin resources: no inline `<script>`/`<style>` or `style=""`
markup (React style props are fine — they go through the CSSOM), images from `'self'`
and `data:`, and WebAssembly through `'wasm-unsafe-eval'`, which the barcode scanner's
zxing-wasm decoder needs to compile (it does not allow `eval()` of JavaScript).

`vite preview` reads the same include and serves the same headers, so the E2E spec
`e2e/tests/csp.spec.js` (the `chromium-preview` project) fails on any CSP violation
before it reaches production.

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
