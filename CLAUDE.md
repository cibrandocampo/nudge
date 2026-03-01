# Nudge — Claude Code instructions

## Development environment: ALWAYS use Docker

**NEVER run Python, Node, or npm directly on the host.**
Always use the Docker development environment defined in `dev/docker-compose.yml`.
This compose uses bind mounts, so local file changes are visible inside the container
immediately — no image rebuild needed.

### Reference commands

| Task | Command |
|---|---|
| **Backend tests** | `docker compose -f dev/docker-compose.yml exec backend python manage.py test` |
| **Tests with coverage** | `docker compose -f dev/docker-compose.yml exec backend coverage run manage.py test` |
| **E2E tests (Playwright)** | `cd e2e && E2E_USERNAME=admin E2E_PASSWORD=<pass> npx playwright test` |
| **Build frontend** | `docker compose -f dev/docker-compose.yml exec frontend npm run build` |
| **Install frontend deps** | `docker compose -f dev/docker-compose.yml exec frontend npm install` |
| **Django shell** | `docker compose -f dev/docker-compose.yml exec backend python manage.py shell` |
| **Makemigrations** | `docker compose -f dev/docker-compose.yml exec backend python manage.py makemigrations` |
| **Migrate** | `docker compose -f dev/docker-compose.yml exec backend python manage.py migrate` |

If the dev environment is not running, start it with:
```bash
docker compose -f dev/docker-compose.yml up -d
```

### Why NOT use `docker compose run --rm backend`
The root `docker-compose.yml` is for **production** — it builds images with `COPY` of the
code. Local changes are not reflected until `docker compose build` is run.
`dev/docker-compose.yml` is the correct one for development.
