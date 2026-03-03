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
docker compose -f dev/docker-compose.yml up -d      # Start all services
docker compose -f dev/docker-compose.yml down         # Stop all
docker compose -f dev/docker-compose.yml restart frontend  # Restart one service
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
docker compose -f dev/docker-compose.yml exec backend python manage.py shell
docker compose -f dev/docker-compose.yml exec backend python manage.py makemigrations
docker compose -f dev/docker-compose.yml exec backend python manage.py migrate
docker compose -f dev/docker-compose.yml exec backend python manage.py createsuperuser

# Tests — backend
docker compose -f dev/docker-compose.yml exec backend python manage.py test                              # full suite
docker compose -f dev/docker-compose.yml exec backend python manage.py test apps.users                   # one app
docker compose -f dev/docker-compose.yml exec backend python manage.py test apps.users.tests.AdminAccessTest  # one class

# Tests — frontend
docker compose -f dev/docker-compose.yml exec frontend npx vitest run                                   # full suite
docker compose -f dev/docker-compose.yml exec frontend npx vitest run src/pages/__tests__/SettingsPage.test.jsx  # one file

# Frontend
docker compose -f dev/docker-compose.yml exec frontend npm install
docker compose -f dev/docker-compose.yml exec frontend npm run build

# Formatting (needed before commits)
docker compose -f dev/docker-compose.yml exec backend ruff format .
docker compose -f dev/docker-compose.yml exec frontend npx prettier --write src/

# Logs
docker compose -f dev/docker-compose.yml logs backend --tail=50
docker compose -f dev/docker-compose.yml logs celery --tail=50
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

**Known pre-existing E2E failures (not our code):**
- `admin login with correct credentials` — test hardcodes password `nudge-admin-2026`
- `admin shows nudge models` — depends on admin login
- `create a routine with preset interval` — expects `"Every 1 week"` but i18n returns `"Every week"`
- `add a lot to a stock item` / `delete a lot` — expects `"3 ud."` but English locale returns `"3 u."`
- `sign out clears session` — occasionally flaky (30s timeout)

## Environment variables

All env vars are in `.env` at the project root. Key ones:
- `ADMIN_PASSWORD` — password for the admin user (auto-created on startup)
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — for Web Push
- `DJANGO_SECRET_KEY`, `POSTGRES_*`, etc.
