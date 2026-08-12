# Nudge

<p align="center">
  <a href="https://hub.docker.com/r/cibrandocampo/nudge-frontend"><img src="https://img.shields.io/docker/pulls/cibrandocampo/nudge-frontend?logo=docker&label=Frontend&color=blue" alt="Docker Hub frontend pulls"/></a>
  <a href="https://hub.docker.com/r/cibrandocampo/nudge-backend"><img src="https://img.shields.io/docker/pulls/cibrandocampo/nudge-backend?logo=docker&label=Backend&color=blue" alt="Docker Hub backend pulls"/></a>
  <a href="https://github.com/cibrandocampo/nudge"><img src="https://img.shields.io/badge/Source-GitHub-181717?logo=github&logoColor=white" alt="Source on GitHub"/></a>
  <a href="https://github.com/cibrandocampo/nudge/releases"><img src="https://img.shields.io/github/v/release/cibrandocampo/nudge?label=Last%20release" alt="Last release"/></a>
  <a href="https://codecov.io/gh/cibrandocampo/nudge"><img src="https://codecov.io/gh/cibrandocampo/nudge/graph/badge.svg" alt="codecov"/></a>
  <a href="https://github.com/cibrandocampo/nudge/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License MIT"/></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white" alt="Python 3.13"/>
  <img src="https://img.shields.io/badge/Django-5.2-092E20?logo=django&logoColor=white" alt="Django 5.2"/>
  <img src="https://img.shields.io/badge/React-19.2-61DAFB?logo=react&logoColor=white" alt="React 19.2"/>
  <img src="https://img.shields.io/badge/Vite-8.1-646CFF?logo=vite&logoColor=white" alt="Vite 8.1"/>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/frontend/public/icons/pwa-512x512.png" width="96" alt="Nudge app icon"/>
  <br/><br/>
  <i>A gentle reminder for recurring things.</i>
  <br/>
  Set the interval once. Get nudged at the right moment. Your server, your rules.
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/dashboard.png" width="240" alt="Nudge dashboard with due and upcoming routines, sharing indicators, and inline stock status"/>
  &nbsp;&nbsp;
  <img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/scan-lot.png" width="240" alt="Nudge scanner open on a medicine box, the DataMatrix framed inside the viewfinder"/>
</p>

<p align="center">
  <a href="https://nudge.cibran.es/"><strong>See the project site →</strong></a>
  <br/>
  <sub>Product tour, screenshots and FAQ. This README is the technical side.</sub>
</p>

---

## What it is

A self-hosted tracker for the things that come round again: medication, filters,
fertiliser, descaling the coffee machine. You set the interval once, Nudge tells
you when it is due, and it keeps the history.

What makes it more than a checklist:

- **Stock that decrements itself.** Attach a consumable to a routine and every
  completion draws it down, lot by lot, First Expired First Out — with expiry
  warnings before anything goes off.
- **Findable at twenty items.** The inventory is one compact row per product —
  what is left, how fast it goes, when it runs out — with a search that matches
  names, categories and batch numbers, filters per category, and up to four
  products pinned to the top. What needs attention is one summary line, not a
  wall of alerts.
- **Scan the box.** Point the camera at the DataMatrix on the packaging and the
  batch, its expiry and the product code fill themselves in — or type them, for
  the boxes where the print is scratched or there is no camera to hand. A pack
  carrying a serial stays one physical box, never merged with another, so "which
  box did I open?" has an answer.
- **Offline-first, honestly.** Mutations queue in IndexedDB, sync when the
  network returns, and a conflict opens a per-field diff instead of guessing.
  Reads come from the service-worker cache.
- **Shared with the household.** Share a routine or a stock item with a contact;
  either of you can complete it and both see the same history.
- **Push that respects the night.** A daily heads-up, an alert when something
  falls due, follow-up reminders — with quiet hours per user.
- **Yours.** No SaaS, no public registration, no telemetry. Backend and database
  never leave the Docker network.

## Up and running in 5 minutes

Two files, a few secrets, `docker compose up`:

```bash
curl -O https://raw.githubusercontent.com/cibrandocampo/nudge/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/cibrandocampo/nudge/main/.env.example
cp .env.example .env
```

Fill in `.env` — at minimum `DJANGO_SECRET_KEY`, the database and Redis
passwords, `ADMIN_PASSWORD`, your domain in `DJANGO_ALLOWED_HOSTS` /
`CORS_ALLOWED_ORIGINS` / `VITE_API_BASE_URL`, and the VAPID key pair if you want
push notifications. Then:

```bash
mkdir -p data
docker compose up -d
```

Log in at `/login` with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Only the frontend
container publishes a port; put a reverse proxy in front of it for TLS.

**→ [Full installation guide](docs/install.md)** — secrets, domain, reverse
proxy, image tags, installing it on a phone.

## Documentation

| | |
|---|---|
| [Installation](docs/install.md) | The complete walkthrough, from download to phone |
| [Configuration](docs/configuration.md) | Every environment variable |
| [Upgrading](docs/upgrade.md) | Version-to-version notes, including the v1.x → v2.0.0 Postgres migration |
| [Backup & restore](docs/backup.md) | Dumping and restoring the database |
| [Troubleshooting](docs/troubleshooting.md) | Logs, restarts, common failures |
| [Architecture](docs/ARCHITECTURE.md) | Data model, auth flow, offline design, decisions |
| [Development](docs/development.md) | Dev environment, quality gates, and the Claude Code workflow this project is built with |

## License

[MIT](LICENSE) © 2026 Cibrán Docampo Piñeiro. Use it, change it, distribute it,
self-host it — personally or commercially — as long as the copyright notice
survives. No warranty.
