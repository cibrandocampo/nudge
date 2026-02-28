---
name: run-tests
description: Run the project test suites. Use after making code changes to verify nothing is broken. Triggers when the user asks to run tests, verify changes, or after completing an implementation task.
---

# Running Tests — Nudge

## Critical Rule

**NEVER run tests on the host.** Always use Docker via `dev/docker-compose.yml`.

## Ensure dev environment is up

```bash
docker compose -f dev/docker-compose.yml ps --format '{{.Service}} {{.State}}'
```

If any service is not running:
```bash
docker compose -f dev/docker-compose.yml up -d
```

## Backend tests (Django — 211+ tests)

```bash
docker compose -f dev/docker-compose.yml exec backend python manage.py test
```

Run a specific app:
```bash
docker compose -f dev/docker-compose.yml exec backend python manage.py test apps.users
```

Run a specific test class:
```bash
docker compose -f dev/docker-compose.yml exec backend python manage.py test apps.users.tests.AdminAccessTest
```

## Frontend tests (Vitest — 167+ tests)

```bash
docker compose -f dev/docker-compose.yml exec frontend npx vitest run
```

Run a specific test file:
```bash
docker compose -f dev/docker-compose.yml exec frontend npx vitest run src/pages/__tests__/SettingsPage.test.jsx
```

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

**Run a specific spec:**
```bash
docker run --rm --network host \
  -e E2E_USERNAME=admin \
  -e E2E_PASSWORD=<password> \
  -e BASE_URL=http://localhost:5173 \
  nudge-e2e npx playwright test tests/dashboard.spec.js
```

The password is in `.env` as `ADMIN_PASSWORD`.

**Known pre-existing failures (not our code):**
- `admin login with correct credentials` — test hardcodes password `nudge-admin-2026`
- `admin shows nudge models` — depends on admin login
- `create a routine with preset interval` — expects `"Every 1 week"` but i18n returns `"Every week"`
- `add a lot to a stock item` / `delete a lot` — expects `"3 ud."` but English locale returns `"3 u."`
- `sign out clears session` — occasionally flaky (30s timeout)

## Verification workflow

After any code change, always run both backend + frontend in parallel:

1. Backend: `docker compose -f dev/docker-compose.yml exec backend python manage.py test`
2. Frontend: `docker compose -f dev/docker-compose.yml exec frontend npx vitest run`

If both pass, the change is safe.

## Known caveats

- jsdom (used by Vitest) does NOT implement `scrollIntoView`, `IntersectionObserver`,
  or other layout APIs. Guard these calls or use `requestAnimationFrame` wrappers.
- Push notification tests mock `navigator.serviceWorker.ready` — the real SW is not
  available in jsdom.
- Frontend test helpers are in `frontend/src/test/helpers.jsx` with MSW handlers in
  `frontend/src/test/mocks/handlers.js`.
