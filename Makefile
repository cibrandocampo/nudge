-include .env

PROD := docker compose
DEV  := docker compose -f dev/docker-compose.yml --env-file .env
E2E_PASSWORD ?= $(ADMIN_PASSWORD)

# ── Production ────────────────────────────────────────────────────────────────

up:         ## Start production environment
	$(PROD) up -d

down:       ## Stop production environment
	$(PROD) down

restart:    ## Restart production environment
	$(PROD) restart

ps:         ## Show production container status
	$(PROD) ps

logs:       ## Tail production logs. Usage: make logs s=backend
	$(PROD) logs -f $(s)

pull:       ## Pull latest production images
	$(PROD) pull

# ── Development ───────────────────────────────────────────────────────────────

dev-up:     ## Start dev environment
	$(DEV) up -d

dev-down:   ## Stop dev environment
	$(DEV) down

dev-restart: ## Restart dev environment
	$(DEV) restart

dev-ps:     ## Show dev container status
	$(DEV) ps

dev-logs:   ## Tail dev logs. Usage: make dev-logs s=backend
	$(DEV) logs -f $(s)

# ── Setup ─────────────────────────────────────────────────────────────────────

init:       ## First-time setup: create .env, start dev, migrate, create admin, install hooks
	@test -f .env || cp .env.example .env && echo "Created .env from .env.example — review it before continuing"
	$(DEV) up -d
	$(DEV) exec backend python manage.py migrate --noinput
	$(DEV) exec backend python manage.py ensure_admin
	bash scripts/install-hooks.sh

hooks:      ## Install git pre-commit hook
	bash scripts/install-hooks.sh

# ── Database (dev) ────────────────────────────────────────────────────────────

db-migrate:         ## Apply migrations
	$(DEV) exec backend python manage.py migrate --noinput

db-makemigrations:  ## Create new migrations
	$(DEV) exec backend python manage.py makemigrations

db-showmigrations:  ## Show migration status
	$(DEV) exec backend python manage.py showmigrations

db-shell:           ## Open PostgreSQL shell
	$(DEV) exec backend python manage.py dbshell

# ── QA ────────────────────────────────────────────────────────────────────────

qa:         ## Full QA pipeline: lint + format-check + test (mirrors GitHub Actions)
	$(MAKE) lint
	$(MAKE) format-check
	$(MAKE) test

# ── Tests ─────────────────────────────────────────────────────────────────────

test:           ## Run all tests (backend + frontend)
	$(DEV) exec backend python manage.py test
	$(DEV) exec frontend npm run test:coverage

test-backend:   ## Run backend tests
	$(DEV) exec backend python manage.py test

test-frontend:  ## Run frontend tests
	$(DEV) exec frontend npm run test:coverage

test-e2e:       ## Run Playwright e2e tests (reads credentials from .env)
	$(DEV) exec -T backend python manage.py ensure_e2e_users
	docker build -f e2e/Dockerfile -t nudge-e2e ./e2e
	docker run --rm --network host \
		-e E2E_USERNAME=admin \
		-e E2E_PASSWORD=$(E2E_PASSWORD) \
		-e BASE_URL=http://localhost:5173 \
		nudge-e2e npx playwright test

# ── Lint & format ─────────────────────────────────────────────────────────────

lint:         ## Check lint (backend + frontend)
	$(DEV) exec backend ruff check .
	$(DEV) exec frontend npm run lint

format:       ## Auto-format code (backend + frontend)
	$(DEV) exec backend ruff format .
	$(DEV) exec frontend npm run format

format-check: ## Check formatting without applying changes
	$(DEV) exec backend ruff format --check .
	$(DEV) exec frontend npm run format:check

# ── Build ─────────────────────────────────────────────────────────────────────

build-backend:  ## Build production backend image
	docker build -f backend/Dockerfile -t cibrandocampo/nudge-backend:latest ./backend

build-frontend: ## Build production frontend image
	docker build -f frontend/Dockerfile -t cibrandocampo/nudge-frontend:latest ./frontend

build:          ## Build both production images
	$(MAKE) build-backend
	$(MAKE) build-frontend

# ── Utilities (dev) ───────────────────────────────────────────────────────────

shell-backend:  ## Open shell in backend container
	$(DEV) exec backend sh

shell-frontend: ## Open shell in frontend container
	$(DEV) exec frontend sh

django-shell:   ## Open Django interactive shell
	$(DEV) exec backend python manage.py shell

vapid:          ## Generate VAPID keys for push notifications
	$(DEV) exec backend python manage.py generate_vapid_keys

screenshots:    ## Regenerate docs/screenshots/*.png against the running dev stack
	docker build -f e2e/Dockerfile -t nudge-e2e ./e2e
	docker run --rm --network host \
		-e E2E_USERNAME=admin \
		-e E2E_PASSWORD=$(ADMIN_PASSWORD) \
		-e E2E_USER2_USERNAME=user1 \
		-e E2E_USER2_PASSWORD=$(E2E_USER1_PASSWORD) \
		-e BASE_URL=http://localhost:5173 \
		-v $(CURDIR)/docs/screenshots:/docs-screenshots \
		nudge-e2e sh -c 'node screenshots.js && cp /e2e/../docs/screenshots/*.png /docs-screenshots/'

# ── Help ──────────────────────────────────────────────────────────────────────

help:       ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

.PHONY: up down restart ps logs pull \
        dev-up dev-down dev-restart dev-ps dev-logs \
        init hooks \
        db-migrate db-makemigrations db-showmigrations db-shell \
        qa test test-backend test-frontend test-e2e \
        lint format format-check \
        build-backend build-frontend build \
        shell-backend shell-frontend django-shell vapid screenshots help
.DEFAULT_GOAL := help
