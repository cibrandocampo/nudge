# Development environment

## Requirements

- Docker and Docker Compose installed on your machine.
- A `.env` file at the project root (copy `.env.example` and fill in the values).

## Makefile

All common tasks have a `make` shortcut. Run `make help` to see the full list.

| Target | Description |
|--------|-------------|
| `make dev-up` | Start dev environment |
| `make dev-down` | Stop dev environment |
| `make dev-logs` | Tail dev logs (`make dev-logs s=backend`) |
| `make dev-ps` | Show container status |
| `make test` | Run all tests (backend + frontend) |
| `make test-backend` | Run backend tests |
| `make test-frontend` | Run frontend tests with coverage |
| `make test-e2e` | Run Playwright e2e tests |
| `make lint` | Check lint (backend + frontend) |
| `make format` | Auto-format (backend + frontend) |
| `make format-check` | Check formatting without applying |
| `make qa` | Full QA pipeline: lint + format-check + test |
| `make db-migrate` | Apply migrations |
| `make db-makemigrations` | Create new migrations |
| `make db-shell` | Open PostgreSQL shell |
| `make shell-backend` | Open shell in backend container |
| `make django-shell` | Open Django interactive shell |
| `make hooks` | Install git pre-commit hook |

The raw `docker compose` commands are documented below for reference.

## Start the environment

```bash
make dev-up
```

Available services:

| Service       | URL                            |
|---------------|--------------------------------|
| Backend       | http://localhost:8000          |
| Frontend      | http://localhost:5173          |
| Django Admin  | http://localhost:8000/admin    |
| PostgreSQL    | localhost:5432                 |
| Redis         | localhost:6379                 |

The backend runs migrations and creates the admin user automatically on first startup.

## Run tests

```bash
make test          # backend + frontend
make test-backend  # backend only
make test-frontend # frontend only (with coverage)
make qa            # lint + format-check + test (mirrors CI)
```

With manual coverage report (backend):

```bash
docker compose -f dev/docker-compose.yml --env-file .env exec backend coverage run manage.py test
docker compose -f dev/docker-compose.yml --env-file .env exec backend coverage report
```

## Linting

```bash
make lint         # check lint (backend + frontend)
make format-check # check formatting without applying
make format       # auto-format (backend + frontend)
```

## Git hooks

```bash
make hooks
```

The hook runs `ruff check`, `ruff format --check`, and `eslint` inside the dev containers. The dev environment must be running for it to work.

## Other useful commands

```bash
# Trigger a Celery task manually
docker compose -f dev/docker-compose.yml --env-file .env exec celery celery -A nudge call apps.notifications.tasks.check_notifications
```

## Regenerate PWA icons

The PWA icons are generated from `frontend/public/icons/source.svg`. To regenerate
them after modifying the SVG source:

```bash
docker compose -f dev/docker-compose.yml --env-file .env run --rm frontend npm run generate-icons
```

This produces all required sizes and formats:

| File | Usage |
|---|---|
| `favicon.ico` | Browser tab |
| `pwa-64x64.png` | Notification badge |
| `pwa-192x192.png` | PWA icon (standard) |
| `pwa-512x512.png` | PWA icon (large) |
| `maskable-icon-512x512.png` | Android adaptive icon |
| `apple-touch-icon-180x180.png` | iOS home screen |

## Rebuild images

Required after changing `requirements.txt` or any `Dockerfile`:

```bash
docker compose -f dev/docker-compose.yml --env-file .env build
```

## Claude Code

This project was developed with the help of [Claude Code](https://claude.ai/code), Anthropic's AI coding assistant.

Custom skills are provided in `.claude/skills/` to help Claude understand the project conventions:

| Skill | Purpose |
|-------|---------|
| `backend-patterns` | Django models, views, serializers, URLs, Celery tasks |
| `frontend-patterns` | React components, pages, API calls, i18n, CSS modules |
| `dev-workflow` | Docker commands, environment setup, debugging |
| `django-admin` | Admin panel customization and branding |
| `git-conventions` | Commit message format, branch naming |

Skills are loaded automatically. Commands are documented in [docs/development.md](../docs/development.md).

| Command | Purpose |
|---------|---------|
| `/dev-1-plan` | Plan a new feature — design doc in `docs/plans/` |
| `/dev-2-tasks` | Break a plan into executable task files |
| `/dev-3-run` | Implement a single task |
| `/dev-4-qa` | Forensic QA — independent verification with evidence |
| `/push` | Commit, create PR, and verify CI pipeline |
| `/fix` | Quick fix — focused bug fix or small change |
| `/audit` | Structured audit of a code area |

## Environment variables (dev only)

The root `.env.example` lists only variables relevant to a production
deployment. The dev stack and the Playwright E2E suite recognise a
handful of additional variables, all with safe defaults in code — you
only need to set them in your local `.env` if you want to override the
default.

| Variable | Default | Purpose |
|----------|---------|---------|
| `E2E_SEED_ALLOWED` | _unset_ | Gate for the destructive `seed_e2e` and `seed_demo` management commands (and the `/api/internal/e2e-seed/` endpoint). Both commands refuse to run unless this is `true` **or** `DJANGO_DEBUG=True`. Never set in production. |
| `E2E_USER1_PASSWORD` | `e2e-pass-1` | Password for the `user1` account created by `seed_e2e`. Read at runtime by the Playwright helpers (`e2e/tests/helpers.js`). |
| `E2E_USER2_PASSWORD` | `e2e-pass-2` | Same for `user2`. |
| `E2E_USER3_PASSWORD` | `e2e-pass-3` | Same for `user3`. |
| `DEMO_USER_PASSWORD` | `demo-pass` | Password for the `cibran` and `maria` accounts created by `seed_demo` (the fixture used to regenerate `docs/screenshots/*.png` via `make screenshots`). |
| `VITE_E2E_MODE` | `false` | Build-time flag consumed by Vite. When `true`, the dev-only reachability hooks (`__NUDGE_REACHABILITY_SET__`, `__NUDGE_REACHABILITY_POLL_MS__`, `__NUDGE_REACHABILITY_LOCK__`, `__NUDGE_SYNC_RETRY_DELAYS_MS__`) are included in the preview build at `:4173` so offline specs can drive the reachability flag without relying on `navigator.onLine`. Set via the `frontend-preview` service in `dev/docker-compose.yml`; not a runtime switch. |

## Landing site

The public project site lives in [`/site/`](../site/README.md) (Astro + Tailwind) and deploys to [`cibrandocampo.github.io/nudge/`](https://cibrandocampo.github.io/nudge/) on every merge to `main` and on every published release, via `.github/workflows/site-deploy.yml`. See [site/README.md](../site/README.md) for how to run it locally, regenerate screenshots (`make screenshots`), and where to edit content.
