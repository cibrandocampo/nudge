# Configuration

All configuration is done via environment variables in the `.env` file. Copy `.env.example` and fill in your values.

```bash
cp .env.example .env
```

## Required variables

These must be set before first startup:

| Variable | Description |
|----------|-------------|
| `DJANGO_SECRET_KEY` | Secret key for Django cryptographic signing. Generate with: `openssl rand -hex 50` (avoid keys with `$` or `&` — they break Docker Compose variable interpolation) |
| `POSTGRES_PASSWORD` | Password for the PostgreSQL database |
| `REDIS_PASSWORD` | Password for Redis authentication |
| `ADMIN_PASSWORD` | Password for the default admin user (created on first boot) |
| `VAPID_PRIVATE_KEY` | Private key for Web Push notifications. Generate with: `pip install py-vapid && vapid --gen` |
| `VAPID_PUBLIC_KEY` | Public key for Web Push notifications (generated with the private key) |

## Admin user (first-boot bootstrap)

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_USERNAME` | `admin` | Username for the default admin account (internal identifier; not shown in the UI) |
| `ADMIN_EMAIL` | `admin@example.com` | Email for the default admin account — used to log in via the email wizard |
| `ADMIN_PASSWORD` | — | Password for the default admin account |

The admin user is created automatically on first startup if no superuser exists. It lands with `auth_method="password"` so you can log in immediately through the email wizard at `/login` (enter `ADMIN_EMAIL`, then the password) **without needing SMTP configured first** — handy because the OTP path needs working email to deliver codes, but this bootstrap account doesn't.

The bootstrap is idempotent and only runs while there is no superuser in the database: changing `ADMIN_PASSWORD` later in `.env` and restarting does **not** rotate the existing user's password. After first boot, change it from the Django admin panel (`/nudge-admin/`).

## Django settings

| Variable | Default | Description |
|----------|---------|-------------|
| `DJANGO_SECRET_KEY` | — | Secret key for cryptographic signing. Use `openssl rand -hex 50` to generate |
| `DJANGO_DEBUG` | `False` | Enable debug mode. **Must be `False` in production** |
| `DJANGO_ALLOWED_HOSTS` | `localhost` | Comma-separated list of allowed hostnames |
| `CORS_ALLOWED_ORIGINS` | — | Comma-separated list of allowed CORS origins (e.g., `https://yourdomain.com`) |
| `CSRF_TRUSTED_ORIGINS` | — | Comma-separated list of origins trusted by Django's CSRF middleware. Mirror `CORS_ALLOWED_ORIGINS` for the public-facing domain — forms submitted from that origin must pass CSRF validation. Required when `DJANGO_DEBUG=False`. |

## Database (PostgreSQL)

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_DB` | `nudge` | Database name |
| `POSTGRES_USER` | `nudge` | Database user |
| `POSTGRES_PASSWORD` | — | Database password. Use alphanumeric characters — `DATABASE_URL` is constructed automatically by Docker Compose from this value, and special characters can break URL parsing |

## Logging

Log levels can be set independently for each service:

| Variable | Default | Controls | Valid values |
|----------|---------|---------|-------------|
| `DJANGO_LOG_LEVEL` | `info` | Django application and apps loggers | `debug`, `info`, `warning`, `error`, `critical` |
| `CELERY_LOG_LEVEL` | `info` | Celery worker and beat scheduler | `debug`, `info`, `warning`, `error`, `critical` |
| `GUNICORN_LOG_LEVEL` | `info` | Gunicorn HTTP server | `debug`, `info`, `warning`, `error`, `critical` |
| `REDIS_LOG_LEVEL` | `notice` | Redis server | `debug`, `verbose`, `notice`, `warning` |
| `POSTGRES_LOG_LEVEL` | `warning` | PostgreSQL `log_min_messages` | `debug5`..`debug1`, `info`, `notice`, `warning`, `error`, `log`, `fatal`, `panic` |
| `NGINX_LOG_LEVEL` | `warn` | Nginx error log | `debug`, `info`, `notice`, `warn`, `error`, `crit`, `alert`, `emerg` |

### Log rotation

The production `docker-compose.yml` does **not** configure a per-container logging driver. This is intentional: platforms like **Synology Container Manager**, **Portainer**, and **QNAP Container Station** manage log viewing and rotation themselves, and overriding the driver at the container level can interfere with their log viewers.

If you run Docker **without** a management platform (plain `docker compose` on a Linux server), it is recommended to configure log rotation at the Docker daemon level to prevent unbounded disk growth. Edit (or create) `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

Then restart the Docker daemon:

```bash
sudo systemctl restart docker
```

This applies the rotation policy globally to all containers.

## Redis / Celery

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_PASSWORD` | — | Password for Redis authentication. Use alphanumeric characters — `REDIS_URL` is constructed automatically by Docker Compose from this value, and special characters can break URL parsing |

## Email (SMTP)

The email-OTP login flow ships outbound messages through Django's
standard email backends. All settings are env-driven so swapping
providers requires no code changes.

| Variable | Default | Description |
|----------|---------|-------------|
| `EMAIL_BACKEND` | `django.core.mail.backends.console.EmailBackend` | Django email backend. Use `django.core.mail.backends.smtp.EmailBackend` in production; `console` is convenient in dev (the message body is printed to stdout) |
| `EMAIL_HOST` | _empty_ | SMTP server hostname (e.g. `smtp.example.com`) |
| `EMAIL_PORT` | `587` | SMTP port |
| `EMAIL_HOST_USER` | _empty_ | SMTP username |
| `EMAIL_HOST_PASSWORD` | _empty_ | SMTP password |
| `EMAIL_USE_TLS` | `True` | Whether to use STARTTLS |
| `DEFAULT_FROM_EMAIL` | `Nudge <noreply@nudge.local>` | From header on every outbound mail |

**Deliverability**: the provider only does half the job. To keep OTP
emails out of the recipient's spam folder you also need DNS records
on the sender's domain:

- **SPF** authorising the provider's SMTP servers to send on behalf of
  the domain.
- **DKIM** — usually configured via the provider's dashboard; produces
  a public-key TXT record that signs every outbound message.
- **DMARC** specifying the policy for receivers when SPF/DKIM fail
  (start with `p=none` and harden later).

A misconfigured DNS will produce intermittent "code never arrived"
reports and is not detectable from the application logs.

In tests (`manage.py test`) the backend is forced to `locmem`
regardless of the env value so test code can assert on
`django.core.mail.outbox`.

## Self-signup

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOW_SELF_SIGNUP` | `False` | When `True`, an unknown email on `POST /api/auth/login/start/` creates a new `is_active=False` user with `auth_method='otp'` and triggers a welcome email containing the OTP. When `False`, unknown emails return `404 user_not_found` — only admin-created accounts can log in. |
| `BLOCK_DISPOSABLE_EMAIL` | `True` in production (`DJANGO_DEBUG=False`), `False` in development | Reject self-signup attempts from disposable / throwaway mailbox providers (yopmail, mailinator, guerrillamail, 10minutemail, …). The blocklist is bundled at `backend/apps/users/disposable_email_domains.txt`. Only applies to **new** signups — existing users with such an email keep their account. The frontend wizard surfaces the rejection as a localised "use a permanent email address" error. |
| `DISPOSABLE_EMAIL_EXTRA_DOMAINS` | _empty_ | Comma-separated list of additional domains to block on top of the bundled file. Useful for blocking providers spotted in the wild without forking the bundled list. Example: `throwaway.example,burner.test`. |
| `DISPOSABLE_EMAIL_ALLOW_DOMAINS` | _empty_ | Comma-separated list of domains to remove from the effective blocklist. Useful when a bundled entry is too aggressive for your deployment. Example: `mailinator.com`. |

Leave `ALLOW_SELF_SIGNUP` at the default (`False`) until ready to open
registration. The admin can flip it on temporarily (e.g. during an
onboarding window) and back off later without restarting any data.

The bundled disposable list is a curated subset of the excellent
community-maintained
[`disposable-email-domains`](https://github.com/disposable-email-domains/disposable-email-domains)
project (CC0-1.0) — thanks to its maintainers for keeping the upstream
list current. A scheduled GitHub Actions workflow
(`.github/workflows/sync-disposable-email-domains.yml`) opens a PR every
Monday when upstream changes, so new throwaway providers are picked up
automatically with a human review step in between. For full
~4500-entry coverage right now without waiting for the next sync,
replace the bundled file with upstream's
`disposable_email_blocklist.conf` manually.

## Branding

| Variable | Default | Description |
|----------|---------|-------------|
| `NUDGE_SITE_URL` | _empty_ | Public URL of this Nudge instance, e.g. `https://nudge.example.com`. Used in the outbound email footer (rendered as "Nudge · `<host>`" with `<host>` linking to this URL). Leave empty to show just "Nudge" with no link. No trailing slash. |

## Web Push (VAPID)

| Variable | Default | Description |
|----------|---------|-------------|
| `VAPID_PRIVATE_KEY` | — | VAPID private key for signing push messages |
| `VAPID_PUBLIC_KEY` | — | VAPID public key (shared with the browser) |
| `VAPID_CLAIMS_EMAIL` | `admin@example.com` | Contact email included in VAPID claims |

Generate the key pair with:

```bash
pip install py-vapid && vapid --gen
```

## Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE_URL` | — | Backend API URL without trailing slash (e.g., `https://yourdomain.com/api`) |
| `VITE_VAPID_PUBLIC_KEY` | — | Same value as `VAPID_PUBLIC_KEY` (exposed to browser) |

## Offline sync safeguards

| Variable | Default | Description |
|----------|---------|-------------|
| `OFFLINE_MAX_CLIENT_TIMESTAMP_SKEW_SECONDS` | _unset_ (no limit) | Maximum allowed skew between a client-reported action timestamp (`client_created_at` on routine logs and stock consumptions) and the server's current time. When unset, arbitrary offline ages are accepted — correct for real-world offline trips of several days. Set to `86400` (24h) or similar if clients ever start drifting or misusing the field. |

## Stock severity thresholds

Thresholds used by the API to classify stock severity (`stock_severity`,
`expiry_severity`) and to estimate depletion from past consumption. Defaults
match the values used in production. A generic API consumer can override these
to match its own policy without touching the code.

| Variable | Default | Description |
|----------|---------|-------------|
| `STOCK_SEVERITY_WARNING_DAYS` | `30` | Days-left threshold below which `stock_severity` returns `low` (when depletion is estimated). Also defines the boundary between `soon` and `healthy` lots in `expiry_severity`. |
| `STOCK_SEVERITY_CRITICAL_DAYS` | `7` | Days-left threshold below which `stock_severity` returns `critical`. |
| `STOCK_LOW_THRESHOLD_UNITS` | `3` | Healthy-quantity threshold below which `stock_severity` returns `low` when no depletion estimate is available (Tipo 1). |
| `STOCK_DIRECT_CONSUMPTION_WINDOW_DAYS` | `60` | Window (days) considered when estimating depletion from past direct consumption. |
| `STOCK_DIRECT_CONSUMPTION_HALF_DAYS` | `30` | Half-window used to validate that consumption is recent enough in both halves before estimating. |

## Docker / Infrastructure

| Variable | Default | Description |
|----------|---------|-------------|
| `PROJECT_NAME` | `nudge` | Docker Compose project name |
| `DOCKER_NUDGE_VERSION` | `stable` | Docker image tag (`latest`, `stable`, or `vX.Y.Z`) |
| `DOCKER_POSTGRES_VERSION` | `16-alpine` | PostgreSQL image version |
| `DOCKER_REDIS_VERSION` | `7-alpine` | Redis image version |
| `NUDGE_HTTP_PORT` | `80` | Port exposed on the host for the frontend |
| `BACKEND_PORT` | `8000` | Internal backend port (don't change unless you also update nginx.conf) |
| `GUNICORN_WORKERS` | `2` | Gunicorn worker processes (rule of thumb: 2 × CPU cores + 1) |
| `DATA_PATH` | `./data` | Host path for PostgreSQL data persistence |

## Development / E2E

Development-only environment variables (E2E seed gate, test-user
passwords, demo-fixture password, preview-build flag) are documented
in [`dev/README.md`](../dev/README.md#environment-variables-dev-only).
They do nothing in a production deployment; all have safe defaults
in code and only need to be overridden when a contributor wants a
custom value locally. Leave them unset in a production `.env`.
