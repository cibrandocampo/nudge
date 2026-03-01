# Nudge

<img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/frontend/public/icons/pwa-512x512.png" width="96" alt="Nudge app icon"/>

[![GitHub](https://img.shields.io/badge/GitHub-Repository-blue?logo=github)](https://github.com/cibrandocampo/nudge)
[![Docker Hub](https://img.shields.io/badge/Docker%20Hub-backend-blue?logo=docker)](https://hub.docker.com/r/cibrandocampo/nudge-backend)
[![Docker Hub](https://img.shields.io/badge/Docker%20Hub-frontend-blue?logo=docker)](https://hub.docker.com/r/cibrandocampo/nudge-frontend)
[![GitHub release](https://img.shields.io/github/v/release/cibrandocampo/nudge)](https://github.com/cibrandocampo/nudge/releases)
[![CI](https://github.com/cibrandocampo/nudge/actions/workflows/ci.yml/badge.svg)](https://github.com/cibrandocampo/nudge/actions/workflows/ci.yml)
[![Python](https://img.shields.io/badge/python-3.12-blue?logo=python)](https://www.python.org/)
[![Django](https://img.shields.io/badge/django-5.2-green?logo=django)](https://www.djangoproject.com/)
[![React](https://img.shields.io/badge/react-18.3-61DAFB?logo=react&logoColor=000)](https://react.dev/)
[![Vite](https://img.shields.io/badge/vite-5.4-646CFF?logo=vite&logoColor=fff)](https://vitejs.dev/)
[![codecov](https://codecov.io/gh/cibrandocampo/nudge/graph/badge.svg)](https://codecov.io/gh/cibrandocampo/nudge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cibrandocampo/nudge/blob/main/LICENSE)

> A gentle reminder for recurring things.

Nudge is a personal PWA that sends you a quiet push notification when something you do regularly is due again — without you having to think about it.

<p align="center">
  <img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/02-dashboard.png" width="260" alt="Dashboard"/>
  &nbsp;&nbsp;
  <img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/03-routine-detail.png" width="260" alt="Routine detail"/>
  &nbsp;&nbsp;
  <img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/05-inventory.png" width="260" alt="Inventory"/>
</p>

---

## What problem does it solve?

Most of us have recurring tasks that are easy to forget, not because they are complicated, but because the interval between them is too long to keep in mind, and too short to leave a mark on a calendar. Nudge keeps track of that gap for you.

You define the task once, tell it how often it should happen, and then you just live your life. When it is time, it nudges you.

---

## Examples

| What | Interval |
|------|----------|
| Take medication | Every 12 hours |
| Water the plants | Every 3 days |
| Change HVAC filter | Every 90 days |
| Deworm the cat | Every 90 days |
| Rotate API keys | Every 90 days |
| Review backups | Every 7 days |

Anything you do on a schedule, Nudge can track.

---

## Features

- **Push notifications** — Browser web push when something comes due. No app store required.
- **Three-stage alerts** — A daily heads-up at your chosen time, a due alert when the interval expires, and follow-up reminders every 8 hours until you mark it done.
- **Inventory tracking** — Optionally attach a consumable to a routine (medication packs, filter cartridges, oil bottles). Each time you log the task, stock decrements automatically using FEFO order (First Expired, First Out).
- **Expiry tracking** — Add lot numbers and expiry dates to your stock. Nudge warns you 90 days before anything expires.
- **Timezone-aware** — Your notification schedule follows your local time and adjusts automatically for daylight saving.
- **Multilingual** — English, Spanish, and Galician.
- **Installable PWA** — Works offline, installs to your home screen on iOS and Android.
- **Multi-user** — Accounts are managed by an admin. There is no public registration, keeping the instance clean.

---

## Screenshots

<table>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/01-login.png" width="260" alt="Login"/><br/><b>Login</b></td>
    <td align="center"><img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/02-dashboard.png" width="260" alt="Dashboard"/><br/><b>Dashboard</b></td>
    <td align="center"><img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/03-routine-detail.png" width="260" alt="Routine detail"/><br/><b>Routine detail</b></td>
  </tr>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/04-new-routine.png" width="260" alt="New routine"/><br/><b>New routine</b></td>
    <td align="center"><img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/05-inventory.png" width="260" alt="Inventory"/><br/><b>Inventory</b></td>
    <td align="center"><img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/06-history.png" width="260" alt="History"/><br/><b>History</b></td>
  </tr>
  <tr>
    <td colspan="3" align="center"><img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/07-settings.png" width="260" alt="Settings"/><br/><b>Settings</b></td>
  </tr>
</table>

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

Choose a strong random string for `POSTGRES_PASSWORD` and `ADMIN_PASSWORD`. Remember to update `DATABASE_URL` to match `POSTGRES_PASSWORD`.

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

All containers write to stdout and use Docker's default `json-file` logging driver, so tools like **Portainer**, **Synology Container Manager**, **Dozzle**, or plain `docker logs` work out of the box.

To cap disk usage, configure log rotation once at the Docker daemon level (`/etc/docker/daemon.json`) instead of per-container — see [docs/configuration.md](https://github.com/cibrandocampo/nudge/blob/main/docs/configuration.md#logging) for details.

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

See [dev/README.md](https://github.com/cibrandocampo/nudge/blob/main/dev/README.md) for the full development setup, including how to run tests, linters, and install the pre-commit hook.

---

## Documentation

- [Configuration](https://github.com/cibrandocampo/nudge/blob/main/docs/configuration.md)
- [Architecture & technical design](https://github.com/cibrandocampo/nudge/blob/main/docs/ARCHITECTURE.md)
- [Development setup](https://github.com/cibrandocampo/nudge/blob/main/dev/README.md)
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

This project was developed with the help of [Claude Code](https://claude.ai/code), Anthropic's AI coding assistant. Custom skills are provided in `.claude/skills/` to maintain project conventions. See [dev/README.md](https://github.com/cibrandocampo/nudge/blob/main/dev/README.md#claude-code) for details.

---

## License

Released under the [MIT License](https://github.com/cibrandocampo/nudge/blob/main/LICENSE) © 2026 Cibrán Docampo Piñeiro.

You are free to **use**, **modify**, **distribute**, and **self-host** this software — personally or commercially — as long as the original copyright notice is preserved. No warranty is provided.
