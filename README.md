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
  <a href="https://nudge.cibran.es/"><strong>See the project site →</strong></a>
  <br/>
  <sub>Product tour, how it works, features, screenshots and FAQ</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/dashboard.png" width="240" alt="Nudge dashboard with due and upcoming routines, sharing indicators, and inline stock status"/>
  &nbsp;&nbsp;
  <img src="https://raw.githubusercontent.com/cibrandocampo/nudge/main/docs/screenshots/lot-selection.png" width="240" alt="Nudge lot-selection modal with two lots of Vitamin D ordered by expiry date (FEFO)"/>
</p>

---

> [!CAUTION]
> **v2.0.0 — Breaking change: Postgres 16 → 17**
>
> Upgrading from any version prior to v2.0.0 requires a **manual database
> migration**. A direct `docker compose pull && docker compose up -d` will
> leave the database crash-looping. Run the migration script first.
>
> → **[Upgrade guide: v1.x → v2.0.0](docs/upgrade.md)**

---

## Self-hosting and technical details

What follows is the reference for running your own instance. For what Nudge does and how it looks in use, see the [project site](https://nudge.cibran.es/).

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

The app is available at the configured port. Admin panel at `/admin/`.

**First login**: head to `/login` and enter `ADMIN_EMAIL` + `ADMIN_PASSWORD`. The bootstrap admin is created with `auth_method="password"` so it works immediately, without any SMTP setup. See the [Authentication](#authentication) section below for opening self-signup and configuring OTP email delivery.

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

- **Backend** — `ruff check`, `ruff format --check`, and the full Django test suite (505 tests) with coverage.
- **Frontend** — ESLint, Prettier, and Vitest (981 tests) with coverage thresholds at 95 % on statements, branches, functions and lines.
- **Coverage reporting** — [Codecov](https://codecov.io/gh/cibrandocampo/nudge) tracks project and patch coverage. The patch gate is 95 % — a pull request that leaves touched lines uncovered is flagged before merge.
- **End-to-end** — 91 Playwright specs covering online and offline flows (dashboard, inventory, history, sharing, i18n, push, plus dedicated offline read / mutations / sync suites). Not wired into CI today; run locally via `make test-e2e`. See `.claude/skills/test-discipline/SKILL.md` for how we handle failing tests.

### Development

A `Makefile` is provided for common tasks — run `make help` to see all targets. See [dev/README.md](https://github.com/cibrandocampo/nudge/blob/main/dev/README.md) for the full development setup, including how to run tests, linters, and install the pre-commit hook.

### Demo seed

A single management command wipes the business tables and rebuilds a deterministic fixture used by both the E2E suite and the public screenshots pipeline:

```bash
docker compose -f dev/docker-compose.yml exec backend python manage.py seed
```

The command is destructive — it removes every non-superuser account, every routine, every stock and every history row. The `admin` superuser is preserved. It refuses to run unless `DJANGO_DEBUG=True` (the default in `dev/docker-compose.yml`) **or** `E2E_SEED_ALLOWED=true` is exported. The production `docker-compose.yml` hard-sets both flags to safe values, so this command cannot run against a production deployment without an explicit override.

The same logic is exposed as `POST /api/internal/seed/` (used by `e2e/global-setup.js` to reset state between test runs).

The fixture creates three users — all with `auth_method="password"` and the same password (the value of `DEMO_USERS_PASSWORD`, default `change-me`), so you can log in directly through the email-based wizard without SMTP setup:

| Email | Display name | Locale | Role |
|-------|--------------|--------|------|
| `cibran@nudge.test` | Cibrán Docampo | en | Protagonist of every screenshot. Owns 8 of the 10 routines. |
| `maria@nudge.test`  | María García   | es | Sharing partner. Owns 2 routines (one shared with cibran, one private). |
| `laura@nudge.test`  | Laura Vázquez  | gl | Third mutual contact, no resources (used by the `unshare` E2E spec). |

After seeding, cibran's dashboard shows nine routines (five private, three he shares with maria, one maria shares with him). The full catalogue of stocks, routines, lots, sharing edges and seeded history is documented in the source: [`backend/apps/core/management/commands/seed.py`](https://github.com/cibrandocampo/nudge/blob/main/backend/apps/core/management/commands/seed.py).

### Authentication

The frontend wizard at `/login` is identical regardless of who the user is — type your email, and the backend tells the client what to ask in step 2:

- **`password`** — user has a password. The wizard asks for it. Used by the bootstrap admin and any user the admin creates manually in Django Admin.
- **`otp`** — passwordless. The wizard asks for a 6-digit code, delivered by email. Used by self-signups, and by users whose admin flipped them in Django Admin.

The `auth_method` is set when the user is created (and can be flipped later from the Django admin user-change form). Initial OTP codes expire in 10 minutes, allow 5 attempts, and are rate-limited per IP and per email destination. Full flow + endpoint reference: [docs/ARCHITECTURE.md#Authentication](https://github.com/cibrandocampo/nudge/blob/main/docs/ARCHITECTURE.md#Authentication).

#### First user — created from env vars

`ADMIN_USERNAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` bootstrap a superuser on first container start, only if no superuser exists yet. The user lands with `auth_method="password"`, so you log in via the regular wizard at `/login` immediately — no SMTP setup required to get into the app. The bootstrap is a one-shot: changing `ADMIN_PASSWORD` later in `.env` does NOT rotate the existing user's password. Change it from `/admin/` instead.

#### Opening self-signup

Disabled by default. To let strangers register from `/login`:

```env
ALLOW_SELF_SIGNUP=True
```

Restart the backend and the `/login` wizard will advertise "Sign in or create an account". Unknown emails then create an `auth_method='otp'` user and the welcome OTP is emailed — so this path **requires working SMTP** (see next section). Registrations from disposable / throwaway mailbox providers (yopmail, mailinator, guerrillamail, 10minutemail, …) are rejected by default in production via [`BLOCK_DISPOSABLE_EMAIL`](https://github.com/cibrandocampo/nudge/blob/main/docs/configuration.md#self-signup); use `DISPOSABLE_EMAIL_EXTRA_DOMAINS` / `DISPOSABLE_EMAIL_ALLOW_DOMAINS` to tune the bundled list. The bundled list is curated from the community-maintained [`disposable-email-domains`](https://github.com/disposable-email-domains/disposable-email-domains) project (CC0-1.0, thanks to its maintainers) and a scheduled GitHub Actions workflow opens a PR when upstream changes, so the list stays current without compromising build determinism.

#### Sending OTP and welcome emails (SMTP)

The OTP path uses Django's standard email backends, fully env-driven. Point the `EMAIL_*` vars at your SMTP provider (OVH, Gmail with app password, Mailtrap, Postmark, …):

```env
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.your-provider.example
EMAIL_PORT=587
EMAIL_HOST_USER=...
EMAIL_HOST_PASSWORD=...
EMAIL_USE_TLS=True
DEFAULT_FROM_EMAIL=Nudge <noreply@yourdomain.com>
NUDGE_SITE_URL=https://yourdomain.com
```

`NUDGE_SITE_URL` is rendered in the email footer as a "Nudge · `<host>`" link back to your deployment — leave it empty if you'd rather not link. Outbound messages are sent as multipart text/HTML with the Nudge logo embedded as a CID attachment and templates localised in en/es/gl.

**Deliverability is your responsibility**: configure SPF, DKIM and DMARC on the sending domain. Without them, OTP codes will routinely land in spam and users will report "the code never arrived". Full SMTP reference + deliverability notes: [docs/configuration.md#email-smtp](https://github.com/cibrandocampo/nudge/blob/main/docs/configuration.md#email-smtp).

### Documentation

- [Configuration](https://github.com/cibrandocampo/nudge/blob/main/docs/configuration.md)
- [Architecture & technical design](https://github.com/cibrandocampo/nudge/blob/main/docs/ARCHITECTURE.md)
- [Development setup](https://github.com/cibrandocampo/nudge/blob/main/dev/README.md)
- [Development — Claude Code workflow](https://github.com/cibrandocampo/nudge/blob/main/docs/development.md)
- [Backup & restore](https://github.com/cibrandocampo/nudge/blob/main/docs/backup.md)
- [Upgrade guide](https://github.com/cibrandocampo/nudge/blob/main/docs/upgrade.md)
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
