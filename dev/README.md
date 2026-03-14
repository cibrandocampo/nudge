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
docker compose -f dev/docker-compose.yml exec backend coverage run manage.py test
docker compose -f dev/docker-compose.yml exec backend coverage report
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
docker compose -f dev/docker-compose.yml exec celery celery -A nudge call apps.notifications.tasks.check_notifications
```

## Regenerate PWA icons

The PWA icons are generated from `frontend/public/icons/source.svg`. To regenerate
them after modifying the SVG source:

```bash
docker compose -f dev/docker-compose.yml run --rm frontend npm run generate-icons
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
docker compose -f dev/docker-compose.yml build
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
