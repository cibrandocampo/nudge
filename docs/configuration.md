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

## Admin user

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_USERNAME` | `admin` | Username for the default admin account |
| `ADMIN_EMAIL` | `admin@example.com` | Email for the default admin account |
| `ADMIN_PASSWORD` | — | Password for the default admin account |

The admin user is created automatically on first startup if no superuser exists.

## Django settings

| Variable | Default | Description |
|----------|---------|-------------|
| `DJANGO_SECRET_KEY` | — | Secret key for cryptographic signing. Use `openssl rand -hex 50` to generate |
| `DJANGO_DEBUG` | `False` | Enable debug mode. **Must be `False` in production** |
| `DJANGO_ALLOWED_HOSTS` | `localhost` | Comma-separated list of allowed hostnames |
| `CORS_ALLOWED_ORIGINS` | — | Comma-separated list of allowed CORS origins (e.g., `https://yourdomain.com`) |

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
