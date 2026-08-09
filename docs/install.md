# Installing Nudge

The complete walkthrough for running your own instance from the published
Docker images. If you just want the three commands, the README has the short
version; this page is the one to follow when something needs explaining.

Everything here assumes Docker with the Compose plugin. No Python, Node or
build step is needed on the host — the images are pre-built.

- [1. Download the files](#1-download-the-files)
- [2. Generate the secrets](#2-generate-the-secrets)
- [3. Configure your domain](#3-configure-your-domain)
- [4. Reverse proxy and HTTPS](#4-reverse-proxy-and-https)
- [5. Start it](#5-start-it)
- [First login](#first-login)
- [Which tag to run](#which-tag-to-run)
- [Install it on a phone](#install-it-on-a-phone)
- [Where the logs go](#where-the-logs-go)

---

## 1. Download the files

```bash
curl -O https://raw.githubusercontent.com/cibrandocampo/nudge/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/cibrandocampo/nudge/main/.env.example
cp .env.example .env
```

## 2. Generate the secrets

**Django secret key:**

```bash
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

Paste the output into `DJANGO_SECRET_KEY` in `.env`.

**VAPID keys** (required for push notifications):

```bash
pip install py-vapid
vapid --gen
vapid --applicationServerKey
```

From the output:

- `Application Server Key` → `VAPID_PUBLIC_KEY` **and** `VITE_VAPID_PUBLIC_KEY`
- `Private key` → `VAPID_PRIVATE_KEY`

> No Python on the host? Run this inside any container that has it
> (`docker exec -it <container> sh`). The `.pem` files `vapid --gen` writes are
> only needed if you want to recover the keys later — they do not belong on the
> server.

**Passwords:** choose strong random strings for `POSTGRES_PASSWORD`,
`REDIS_PASSWORD` and `ADMIN_PASSWORD`. Keep them alphanumeric — `DATABASE_URL`
and `REDIS_URL` are assembled from these values, and special characters can
break URL parsing.

## 3. Configure your domain

```env
DJANGO_ALLOWED_HOSTS=nudge.example.com,localhost
CORS_ALLOWED_ORIGINS=https://nudge.example.com
VITE_API_BASE_URL=https://nudge.example.com/api
```

> `localhost` must stay in `DJANGO_ALLOWED_HOSTS`: the Docker healthcheck talks
> to the backend directly on `localhost:8000`, and Django would reject it
> otherwise.

> Reaching the app by IP during setup, before DNS or the proxy are ready? Add
> that address too: `DJANGO_ALLOWED_HOSTS=nudge.example.com,localhost,192.168.1.10`.

Every other option is documented in [configuration.md](configuration.md).

## 4. Reverse proxy and HTTPS

The frontend container is the only one that publishes a port (default `80`, or
whatever `NUDGE_HTTP_PORT` says). Backend, database and Redis stay internal and
are never exposed directly.

For anything public, put a reverse proxy in front — nginx, Traefik, Caddy, the
Synology reverse proxy — to terminate TLS and forward to `NUDGE_HTTP_PORT`. If
port 80 is already taken on the host, set `NUDGE_HTTP_PORT` to a free internal
port such as `8080`.

## 5. Start it

```bash
mkdir -p data
docker compose up -d
```

The app answers on the configured port; the Django admin lives at `/admin/`.

## First login

Go to `/login` and enter `ADMIN_EMAIL` and `ADMIN_PASSWORD`. The bootstrap admin
is created with `auth_method="password"`, so it works immediately — no SMTP
required to get in.

That bootstrap runs only while no superuser exists: changing `ADMIN_PASSWORD` in
`.env` later does **not** rotate the password. Change it from `/admin/` instead.

To let other people register themselves you need `ALLOW_SELF_SIGNUP=True` **and**
working SMTP, because that path delivers a one-time code by email. Both are
covered in [configuration.md](configuration.md#self-signup) and
[configuration.md](configuration.md#email-smtp); the login flow itself is
described in [ARCHITECTURE.md](ARCHITECTURE.md#authentication).

## Which tag to run

Pre-built multi-arch images (linux/amd64 + linux/arm64) are published to Docker
Hub:

| Image | Tag | Published |
|-------|-----|-----------|
| `cibrandocampo/nudge-backend` | `latest` | every push to `main` |
| `cibrandocampo/nudge-frontend` | `latest` | every push to `main` |
| Both | `stable` + `X.Y.Z` | on each GitHub release |

`docker-compose.yml` defaults to `stable`, which is what you want for a real
deployment — pin `X.Y.Z` if you would rather upgrade deliberately. Images are
also rebuilt weekly so base-image and dependency security patches land without
waiting for a release.

Moving between major versions? Read [upgrade.md](upgrade.md) first.

## Install it on a phone

Nudge is a Progressive Web App: installed from the browser it lives on the home
screen and can receive push notifications.

**Android** (Chrome, Edge, Samsung Internet)

1. Open Nudge in the browser.
2. Open the browser menu (three dots).
3. Tap **Add to Home screen** (or **Install app**).
4. Confirm — the icon appears on the home screen.

**iOS** (Safari only; Chrome and Firefox on iOS cannot install PWAs)

1. Open Nudge in Safari.
2. Tap **Share** (the square with the up arrow).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**.

Then open it from the icon and turn on push notifications from Settings.

### Push timing on Android

Android's battery optimisation (Doze) can hold push notifications until you next
touch the phone. This affects every PWA running inside Chrome, whatever the app
or the server does.

With the default **Optimised** battery mode, messages are queued by FCM and
arrive within seconds of unlocking the screen — for a reminders app that is
usually fine. For delivery while the screen is still off, set
**Settings → Apps → Chrome → Battery → Unrestricted** (the exact path varies by
manufacturer).

> This is an OS-level restriction, not a Nudge limitation: the same applies to
> web push from any site.

## Where the logs go

Every container writes to stdout through Docker's default `json-file` driver, so
Synology Container Manager, Portainer and friends pick them up with no extra
configuration. On plain Docker with no management UI, configure daemon-level
rotation — see [configuration.md](configuration.md#log-rotation).

Day-to-day commands for reading logs and restarting services live in
[troubleshooting.md](troubleshooting.md).
