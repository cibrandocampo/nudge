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

## E2E tests (Playwright — runs on host)

Playwright is the only thing that runs on the host (needs a real browser).
Requires credentials and the dev environment running:

```bash
cd e2e && E2E_USERNAME=admin E2E_PASSWORD=<password> npx playwright test
```

Run a specific spec:
```bash
cd e2e && E2E_USERNAME=admin E2E_PASSWORD=<password> npx playwright test settings.spec.js
```

The password is in `.env` as `ADMIN_PASSWORD`.

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
