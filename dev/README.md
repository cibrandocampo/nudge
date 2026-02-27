# Development environment

## Requirements

- Docker and Docker Compose installed on your machine.
- A `.env` file at the project root (copy `.env.example` and fill in the values).

## Start the environment

```bash
docker compose -f dev/docker-compose.yml up
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

### Backend

```bash
docker compose -f dev/docker-compose.yml exec backend python manage.py test
```

With coverage report:

```bash
docker compose -f dev/docker-compose.yml exec backend coverage run manage.py test
docker compose -f dev/docker-compose.yml exec backend coverage report
```

### Frontend

```bash
docker compose -f dev/docker-compose.yml exec frontend npm test
```

With coverage report:

```bash
docker compose -f dev/docker-compose.yml exec frontend npm run test:coverage
```

## Linting

### Backend (ruff)

```bash
docker compose -f dev/docker-compose.yml exec backend ruff check .
docker compose -f dev/docker-compose.yml exec backend ruff format --check .
```

Auto-fix issues:

```bash
docker compose -f dev/docker-compose.yml exec backend ruff check --fix .
docker compose -f dev/docker-compose.yml exec backend ruff format .
```

### Frontend (ESLint)

```bash
docker compose -f dev/docker-compose.yml exec frontend npx eslint src/
```

## Git hooks

Install the pre-commit hook to run linters automatically before each commit:

```bash
bash scripts/install-hooks.sh
```

The hook runs `ruff check`, `ruff format --check`, and `eslint` inside the dev containers. The dev environment must be running for it to work.

## Other useful commands

```bash
# Create a migration
docker compose -f dev/docker-compose.yml exec backend python manage.py makemigrations

# Open the Django shell
docker compose -f dev/docker-compose.yml exec backend python manage.py shell

# Trigger a Celery task manually
docker compose -f dev/docker-compose.yml exec celery celery -A nudge call apps.notifications.tasks.check_notifications

# Open psql
docker compose -f dev/docker-compose.yml exec db psql -U nudge nudge
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
| `run-tests` | Test execution commands |

These skills are automatically loaded when using Claude Code in this repository.
