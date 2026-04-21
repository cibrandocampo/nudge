# Nudge

<p align="center">
  <a href="https://hub.docker.com/r/cibrandocampo/nudge-backend"><img src="https://img.shields.io/badge/Docker%20Hub-backend-blue?logo=docker" alt="Docker Hub backend"/></a>
  <a href="https://hub.docker.com/r/cibrandocampo/nudge-frontend"><img src="https://img.shields.io/badge/Docker%20Hub-frontend-blue?logo=docker" alt="Docker Hub frontend"/></a>
  <a href="https://github.com/cibrandocampo/nudge/releases"><img src="https://img.shields.io/github/v/release/cibrandocampo/nudge" alt="GitHub release"/></a>
  <a href="https://github.com/cibrandocampo/nudge/actions/workflows/ci.yml"><img src="https://github.com/cibrandocampo/nudge/actions/workflows/ci.yml/badge.svg" alt="CI"/></a>
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

<p align="center">
  <a href="https://cibrandocampo.github.io/nudge/"><strong>See the project site →</strong></a>
  <br/>
  <sub>Product tour, how it works, features, screenshots and FAQ</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/dashboard.png" width="240" alt="Nudge dashboard with due and upcoming routines, sharing indicators, and inline stock status"/>
  &nbsp;&nbsp;
  <img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/lot-selection.png" width="240" alt="Nudge lot-selection modal with two lots of Vitamin D ordered by expiry date (FEFO)"/>
</p>

---

## Self-hosting and technical details

What follows is the reference for running your own instance. For what Nudge does and how it looks in use, see the [project site](https://cibrandocampo.github.io/nudge/).

### Quick start

**1. Download the files**

```bash
curl -O https://raw.githubusercontent.com/cibrandocampo/nudge/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/cibrandocampo/nudge/main/.env.example
cp .env.example .env
```

**2. Generate the required secrets**

Django secret key:

```bash
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

Paste the output into `DJANGO_SECRET_KEY` in `.env`.

VAPID keys (required for push notifications):

```bash
pip install py-vapid
vapid --gen
vapid --applicationServerKey
```

From the output:

- `Application Server Key` → `VAPID_PUBLIC_KEY` and `VITE_VAPID_PUBLIC_KEY`
- `Private key` → `VAPID_PRIVATE_KEY`

> If you don't have Python locally, run this inside any Docker container that has Python (`docker exec -it <container> sh`). The `.pem` files created by `vapid --gen` are only needed to recover the keys later — you do not need to keep them on the server.

Choose strong random strings for `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, and `ADMIN_PASSWORD`. Use alphanumeric characters — `DATABASE_URL` and `REDIS_URL` are constructed automatically from these values, and special characters can break URL parsing.

**3. Configure your domain**

Edit `.env` and set:

```env
DJANGO_ALLOWED_HOSTS=nudge.example.com,localhost
CORS_ALLOWED_ORIGINS=https://nudge.example.com
VITE_API_BASE_URL=https://nudge.example.com/api
```

> `localhost` must always be present in `DJANGO_ALLOWED_HOSTS` — the Docker healthcheck contacts the backend directly on `localhost:8000` and Django would reject the request otherwise.

> If you need to access the app by IP during initial setup (before DNS/reverse proxy is ready), add that IP too: `DJANGO_ALLOWED_HOSTS=nudge.example.com,localhost,192.168.1.10`.

**4. Reverse proxy and HTTPS**

The frontend container is the only one that exposes a port (default `80`, or whatever you set in `NUDGE_HTTP_PORT`). The backend, database, and Redis are internal — never exposed directly.

For a public deployment, put a reverse proxy in front (nginx, Traefik, Caddy, Synology reverse proxy, etc.) to terminate TLS and forward traffic to `NUDGE_HTTP_PORT`. Set `NUDGE_HTTP_PORT` to a free internal port (e.g. `8080`) if port 80 is already in use on the host.

**5. Start**

```bash
mkdir -p data
docker compose up -d
```

The app is available at the configured port. Admin panel at `/nudge-admin/`.

For all configuration options, see [docs/configuration.md](https://github.com/cibrandocampo/nudge/blob/main/docs/configuration.md).

### Logs

All containers write to stdout using Docker's default `json-file` driver. Platforms like Synology Container Manager or Portainer handle log viewing and rotation automatically. If you run plain Docker without a management UI, consider configuring daemon-level log rotation — see [docs/configuration.md](https://github.com/cibrandocampo/nudge/blob/main/docs/configuration.md#log-rotation) for details.

### Install as an app (PWA)

Nudge is a Progressive Web App. Installed from the browser, it lives on your home screen with push notifications enabled.

**Android** (Chrome, Edge, Samsung Internet)

1. Open Nudge in your browser.
2. Tap the browser menu (three dots).
3. Tap **Add to Home screen** (or **Install app**).
4. Confirm — the Nudge icon appears on your home screen.

**iOS** (Safari only — Chrome and Firefox on iOS do not support PWA installation)

1. Open Nudge in Safari.
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add** to confirm.

Once installed, open Nudge from the home screen icon and enable push notifications from the Settings page.

#### Push notifications on Android — battery optimisation

Android's battery optimisation (Doze mode) can delay push notifications until the next time you interact with your phone. This affects all PWAs running inside Chrome, regardless of app or server settings.

**What to expect with the default "Optimised" battery mode:** Notifications are queued by FCM and delivered within seconds of unlocking your screen. For a reminders app this is usually fine — you will see pending alerts the moment you pick up your phone.

**For instant delivery even while the screen is off:** go to **Settings → Apps → Chrome → Battery → Unrestricted** (exact path varies by manufacturer). This allows Chrome to receive push messages in the background without delay.

> This is an OS-level restriction, not a Nudge limitation. The same behaviour affects every web push notification on Android, including those from other websites and PWAs.

### Quality

Every change goes through GitHub Actions with no shortcuts:

- **Backend** — `ruff check`, `ruff format --check`, and the full Django test suite (480 tests) with coverage.
- **Frontend** — ESLint, Prettier, and Vitest (754 tests) with coverage thresholds at 95 % on statements, branches, functions and lines.
- **Coverage reporting** — [Codecov](https://codecov.io/gh/cibrandocampo/nudge) tracks project and patch coverage. The patch gate is 95 % — a pull request that leaves touched lines uncovered is flagged before merge.
- **End-to-end** — 84 Playwright specs covering online and offline flows (dashboard, inventory, history, sharing, i18n, push, plus dedicated offline read / mutations / sync suites). Not wired into CI today; run locally via `make test-e2e`. See `.claude/skills/test-discipline/SKILL.md` for how we handle failing tests.

### Development

A `Makefile` is provided for common tasks — run `make help` to see all targets. See [dev/README.md](https://github.com/cibrandocampo/nudge/blob/main/dev/README.md) for the full development setup, including how to run tests, linters, and install the pre-commit hook.

### Documentation

- [Configuration](https://github.com/cibrandocampo/nudge/blob/main/docs/configuration.md)
- [Architecture & technical design](https://github.com/cibrandocampo/nudge/blob/main/docs/ARCHITECTURE.md)
- [Development setup](https://github.com/cibrandocampo/nudge/blob/main/dev/README.md)
- [Development — Claude Code workflow](https://github.com/cibrandocampo/nudge/blob/main/docs/development.md)
- [Backup & restore](https://github.com/cibrandocampo/nudge/blob/main/docs/backup.md)
- [Troubleshooting](https://github.com/cibrandocampo/nudge/blob/main/docs/troubleshooting.md)

### Docker images

Pre-built multi-arch images (linux/amd64 + linux/arm64) are published to Docker Hub on every push to `main` and on each release.

| Image | Tag | When |
|-------|-----|------|
| `cibrandocampo/nudge-backend` | `latest` | Every push to main |
| `cibrandocampo/nudge-frontend` | `latest` | Every push to main |
| Both | `stable` + `vX.Y.Z` | On GitHub release |

Images are also rebuilt weekly to pick up base-image and dependency security patches.

### Built with Claude Code

This project was developed with the help of [Claude Code](https://claude.ai/code), Anthropic's AI coding assistant. Custom skills and commands live in `.claude/` to maintain project conventions. See [dev/README.md](https://github.com/cibrandocampo/nudge/blob/main/dev/README.md#claude-code) for details.

### License

Released under the [MIT License](https://github.com/cibrandocampo/nudge/blob/main/LICENSE) © 2026 Cibrán Docampo Piñeiro.

You are free to **use**, **modify**, **distribute**, and **self-host** this software — personally or commercially — as long as the original copyright notice is preserved. No warranty is provided.
