# Configuration

All configuration is done via environment variables in the `.env` file. Copy `.env.example` and fill in your values.

```bash
cp .env.example .env
```

## Required variables

These must be set before first startup:

| Variable | Description |
|----------|-------------|
| `DJANGO_SECRET_KEY` | Secret key for Django cryptographic signing. Generate with: `python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"` |
| `POSTGRES_PASSWORD` | Password for the PostgreSQL database |
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
| `DJANGO_SECRET_KEY` | — | Secret key for cryptographic signing |
| `DJANGO_DEBUG` | `False` | Enable debug mode. **Must be `False` in production** |
| `DJANGO_ALLOWED_HOSTS` | `localhost` | Comma-separated list of allowed hostnames |
| `CORS_ALLOWED_ORIGINS` | — | Comma-separated list of allowed CORS origins (e.g., `https://yourdomain.com`) |

## Database (PostgreSQL)

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_DB` | `nudge` | Database name |
| `POSTGRES_USER` | `nudge` | Database user |
| `POSTGRES_PASSWORD` | — | Database password |
| `DATABASE_URL` | — | Full connection URL (e.g., `postgresql://nudge:password@db:5432/nudge`) |

## Redis / Celery

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://redis:6379/0` | Redis connection URL for Celery |
| `LOG_LEVEL` | `info` | Celery log level (`debug`, `info`, `warning`, `error`, `critical`) |

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
