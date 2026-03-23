# Nudge

<p align="center">
  <a href="https://github.com/cibrandocampo/nudge"><img src="https://img.shields.io/badge/GitHub-Repository-blue?logo=github" alt="GitHub"/></a>
  <a href="https://hub.docker.com/r/cibrandocampo/nudge-backend"><img src="https://img.shields.io/badge/Docker%20Hub-backend-blue?logo=docker" alt="Docker Hub backend"/></a>
  <a href="https://hub.docker.com/r/cibrandocampo/nudge-frontend"><img src="https://img.shields.io/badge/Docker%20Hub-frontend-blue?logo=docker" alt="Docker Hub frontend"/></a>
  <a href="https://github.com/cibrandocampo/nudge/releases"><img src="https://img.shields.io/github/v/release/cibrandocampo/nudge" alt="GitHub release"/></a>
  <a href="https://github.com/cibrandocampo/nudge/actions/workflows/ci.yml"><img src="https://github.com/cibrandocampo/nudge/actions/workflows/ci.yml/badge.svg" alt="CI"/></a>
  <a href="https://www.python.org/"><img src="https://img.shields.io/badge/python-3.12-blue?logo=python" alt="Python"/></a>
  <a href="https://www.djangoproject.com/"><img src="https://img.shields.io/badge/django-5.2-green?logo=django" alt="Django"/></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/react-18.3-61DAFB?logo=react&logoColor=000" alt="React"/></a>
  <a href="https://vitejs.dev/"><img src="https://img.shields.io/badge/vite-5.4-646CFF?logo=vite&logoColor=fff" alt="Vite"/></a>
  <a href="https://codecov.io/gh/cibrandocampo/nudge"><img src="https://codecov.io/gh/cibrandocampo/nudge/graph/badge.svg" alt="codecov"/></a>
  <a href="https://github.com/cibrandocampo/nudge/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License MIT"/></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/frontend/public/icons/pwa-512x512.png" width="96" alt="Nudge app icon"/>
  <br/><br/>
  <i>A gentle reminder for recurring things.</i>
  <br/>
  Set the interval once. Get nudged at the right moment. Your server, your rules.
</p>

---

## A closer look - How it works?

### Access — secure by default

<img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/01-login.png" align="right" width="260" alt="Nudge login screen with username and password fields"/>

Nudge has no public registration. Accounts are created by an admin, keeping the instance private and under your control. Authentication uses short-lived JWT access tokens and a rotating refresh token — sessions stay alive without prompting for credentials repeatedly, and the API rejects any unauthenticated request.

The backend and database are never exposed outside the Docker network. Only the frontend container has a public-facing port.

<br clear="right"/>

---

### Dashboard and routine detail — your schedule, always in view

<p align="center">
  <img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/02-dashboard.png" width="260" alt="Nudge dashboard showing due and upcoming recurring tasks with push notification indicators"/>
  &nbsp;&nbsp;
  <img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/04-routine-detail.png" width="260" alt="Nudge routine detail page showing next due date, linked stock usage, and completion history"/>
</p>

The dashboard is the heart of Nudge — a single view of what is due now and what is coming up. Each routine card shows how overdue or how close to due it is. Tapping one opens the detail view, where you see the exact next due date alongside a human-readable relative time (e.g. "In 3 days · 13 Mar, 10:30"), the full completion history, and the current stock level if a consumable is attached.

Notifications work in three stages: a daily heads-up at your chosen time, a due alert the moment the interval expires, and follow-up reminders every 8 hours until you mark the task as done.

---

### Creating a routine — simple by design

<img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/05-new-routine.png" align="left" width="260" alt="Nudge form for creating a new recurring task with name, interval, and optional stock link"/>

Setting up a routine takes seconds. Give it a name, set the interval in hours (or days — the form converts automatically), and optionally link a consumable stock item with the amount used per completion. That is all Nudge needs to start tracking and notifying.

Routines can be paused at any time without losing their history, and re-activated when needed.

<br clear="left"/>

---

### Inventory — track what you consume

<img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/06-inventory.png" align="right" width="260" alt="Nudge inventory screen with stock items, lot numbers, quantities, and expiry dates grouped by category"/>

Attach a consumable to any routine and Nudge will decrement stock automatically each time you log a completion, using FEFO order (First Expired, First Out) across lots. Stock can be organized into categories — Health, Home, Pets, or any group you define — and each lot can carry an expiry date. Nudge warns you 90 days before anything expires so you always have time to restock.

<br clear="right"/>

---

### Sharing — built for households and teams

<p align="center">
  <img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/03-dashboard-sharing.png" width="260" alt="Nudge sharing modal showing a list of contacts to share a routine with, with selected contacts highlighted"/>
  &nbsp;&nbsp;
  <img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/09-shared-dashboard.png" width="260" alt="Nudge dashboard from a recipient's perspective showing routines shared by another user with an owner label"/>
</p>

Share any routine or stock item with people you trust. A full-screen sharing modal lets you pick contacts with a single tap — no accidental navigation on mobile. The recipient gets a push notification the moment something is shared with them, and the shared item appears on their dashboard with an owner label. They can mark it as done too, which counts for both of you.

---

### History and settings — full control, zero friction

<p align="center">
  <img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/07-history.png" width="260" alt="Nudge history page showing a paginated log of all completed routines with timestamps and notes"/>
  &nbsp;&nbsp;
  <img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/08-settings.png" width="260" alt="Nudge settings page with language selector, timezone picker, and daily notification time input"/>
</p>

The history page gives you a paginated log of every completion across all routines. Settings let each user independently choose their language (English, Spanish, or Galician), their local timezone — so notifications fire at the right clock time year-round, DST included — and their preferred daily heads-up time.

---

## Features

- **Push notifications** — Browser web push when something comes due. Daily heads-up at your chosen time, a due alert when the interval expires, and follow-up reminders every 8 hours until you mark it done. No app store, no account required beyond your own server.
- **Sharing** — Share routines and stock items with trusted contacts. Shared items appear on the recipient's dashboard with an owner label — they can see progress and mark tasks as done too. Everyone gets a push notification when they're added as a contact or when something new is shared with them.
- **Inventory tracking** — Attach a consumable to a routine (medication packs, filter cartridges, oil bottles). Each time you log the task, stock decrements automatically using FEFO order (First Expired, First Out). Organize into categories and get an expiry warning 90 days in advance.
- **Installable PWA** — Works offline, installs to your home screen on iOS and Android. Feels like a native app — because the web platform is good enough now.
- **Timezone-aware** — Your notification schedule follows your local time and adjusts automatically for daylight saving.
- **Multilingual** — English, Spanish, and Galician.
- **Multi-user** — Accounts are managed by an admin. There is no public registration, keeping the instance clean and yours.

---

## Quality

Every change goes through a CI pipeline (GitHub Actions) with no shortcuts:

- **Backend**: ruff (lint + format) and the full Django test suite with coverage.
- **Frontend**: ESLint, Prettier, and Vitest with coverage.
- **Coverage gate**: [Codecov](https://codecov.io/gh/cibrandocampo/nudge) enforces that every modified line is covered by tests. A pull request that leaves any touched line uncovered is blocked from merging. Defensive guards that can't be reached must be removed, not exempted.

The Codecov badge at the top of this page reflects the current state.

---

## Quick start (self-hosted)

### 1. Download the files

```bash
curl -O https://raw.githubusercontent.com/cibrandocampo/nudge/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/cibrandocampo/nudge/main/.env.example
cp .env.example .env
```

### 2. Generate the required secrets

**Django secret key**

```bash
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

Paste the output into `DJANGO_SECRET_KEY` in `.env`.

**VAPID keys** (required for push notifications)

```bash
pip install py-vapid
vapid --gen
vapid --applicationServerKey
```

From the output:
- `Application Server Key` → `VAPID_PUBLIC_KEY` and `VITE_VAPID_PUBLIC_KEY`
- `Private key` → `VAPID_PRIVATE_KEY`

> If you don't have Python locally, run this inside any Docker container that has Python (`docker exec -it <container> sh`). The `.pem` files created by `vapid --gen` are only needed to recover the keys later — you do not need to keep them on the server.

**Passwords**

Choose a strong random string for `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, and `ADMIN_PASSWORD`. Use alphanumeric characters — `DATABASE_URL` and `REDIS_URL` are constructed automatically by Docker Compose from these values, and special characters can break URL parsing.

### 3. Configure your domain

Edit `.env` and set:

```env
DJANGO_ALLOWED_HOSTS=nudge.example.com,localhost
CORS_ALLOWED_ORIGINS=https://nudge.example.com
VITE_API_BASE_URL=https://nudge.example.com/api
```

> `localhost` must always be present in `DJANGO_ALLOWED_HOSTS` — the Docker healthcheck contacts the backend directly on `localhost:8000` and Django would reject the request otherwise.

> If you need to access the app by IP during initial setup (before DNS/reverse proxy is ready), add that IP too: `DJANGO_ALLOWED_HOSTS=nudge.example.com,localhost,192.168.1.10`.

### 4. Reverse proxy and HTTPS

The frontend container is the only one that exposes a port (default `80`, or whatever you set in `NUDGE_HTTP_PORT`). The backend, database, and Redis are internal — never exposed directly.

For a public deployment, put a reverse proxy in front (nginx, Traefik, Caddy, Synology reverse proxy, etc.) to terminate TLS and forward traffic to `NUDGE_HTTP_PORT`. Set `NUDGE_HTTP_PORT` to a free internal port (e.g. `8080`) if port 80 is already in use on the host.

### 5. Start

```bash
mkdir -p data
docker compose up -d
```

The app is available at the configured port. Admin panel at `/nudge-admin/`.

For all configuration options, see [docs/configuration.md](https://github.com/cibrandocampo/nudge/blob/main/docs/configuration.md).

### Logs

All containers write to stdout using Docker's default `json-file` driver. Platforms like **Synology Container Manager** or **Portainer** handle log viewing and rotation automatically. If you run plain Docker without a management UI, consider configuring daemon-level log rotation — see [docs/configuration.md](https://github.com/cibrandocampo/nudge/blob/main/docs/configuration.md#log-rotation) for details.

---

## Install as an app (PWA)

Nudge is a Progressive Web App — it can be installed on your home screen and works like a native app, with push notifications included. No app store required.

**Android** (Chrome, Edge, Samsung Internet)

1. Open Nudge in your browser
2. Tap the browser menu (three dots)
3. Tap **Add to Home screen** (or **Install app**)
4. Confirm — the Nudge icon will appear on your home screen

**iOS** (Safari only — Chrome and Firefox on iOS do not support PWA installation)

1. Open Nudge in **Safari**
2. Tap the **Share** button (the square with an arrow pointing up)
3. Scroll down and tap **Add to Home Screen**
4. Tap **Add** to confirm

Once installed, open Nudge from the home screen icon and enable push notifications from the Settings page.

---

## Development

A `Makefile` is provided for common tasks — run `make help` to see all available targets. See [dev/README.md](https://github.com/cibrandocampo/nudge/blob/main/dev/README.md) for the full development setup, including how to run tests, linters, and install the pre-commit hook.

---

## Documentation

- [Configuration](https://github.com/cibrandocampo/nudge/blob/main/docs/configuration.md)
- [Architecture & technical design](https://github.com/cibrandocampo/nudge/blob/main/docs/ARCHITECTURE.md)
- [Development setup](https://github.com/cibrandocampo/nudge/blob/main/dev/README.md)
- [Development — Claude Code workflow](https://github.com/cibrandocampo/nudge/blob/main/docs/development.md)
- [Backup & restore](https://github.com/cibrandocampo/nudge/blob/main/docs/backup.md)
- [Troubleshooting](https://github.com/cibrandocampo/nudge/blob/main/docs/troubleshooting.md)

---

## Docker images

Pre-built multi-arch images (linux/amd64 + linux/arm64) are published to Docker Hub on every push to `main` and on each release.

| Image | Tag | When |
|-------|-----|------|
| `cibrandocampo/nudge-backend` | `latest` | Every push to main |
| `cibrandocampo/nudge-frontend` | `latest` | Every push to main |
| Both | `stable` + `vX.Y.Z` | On GitHub release |

Images are also rebuilt weekly to pick up base-image and dependency security patches.

---

## Built with Claude Code

This project was developed with the help of [Claude Code](https://claude.ai/code), Anthropic's AI coding assistant. Custom skills and commands are provided in `.claude/` to maintain project conventions. See [dev/README.md](https://github.com/cibrandocampo/nudge/blob/main/dev/README.md#claude-code) for details.

---

## License

Released under the [MIT License](https://github.com/cibrandocampo/nudge/blob/main/LICENSE) © 2026 Cibrán Docampo Piñeiro.

You are free to **use**, **modify**, **distribute**, and **self-host** this software — personally or commercially — as long as the original copyright notice is preserved. No warranty is provided.
