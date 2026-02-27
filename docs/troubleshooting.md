# Troubleshooting

## View logs

```bash
# All services
docker compose logs -f

# Single service
docker compose logs -f backend
docker compose logs -f celery
docker compose logs -f frontend
docker compose logs -f db
```

## Restart a service

```bash
docker compose restart backend
docker compose restart celery
```

## Full restart (keeps data)

```bash
docker compose down && docker compose up -d
```

---

## Common errors

### `502 Bad Gateway` in browser

The frontend nginx cannot reach the backend.

1. Check that the backend container is running: `docker compose ps`
2. Check backend logs: `docker compose logs backend`
3. If the backend crashed on startup, look for migration or config errors.

### Backend won't start — "VAPID keys not configured"

The `.env` file is missing `VAPID_PRIVATE_KEY` or `VAPID_PUBLIC_KEY`.

Generate a VAPID key pair once:

```bash
python3 -c "from py_vapid import Vapid; v = Vapid(); v.generate_keys(); print('PRIVATE:', v.private_key); print('PUBLIC:', v.public_key_pem)"
```

Add the keys to `.env` and restart:

```bash
docker compose restart backend
```

### Celery tasks not running / push not sent

1. Check that Celery is running: `docker compose ps celery`
2. Check Celery logs for errors: `docker compose logs celery`
3. Verify Redis is healthy: `docker compose exec redis redis-cli ping` (should return `PONG`)

### Database migration errors on startup

```bash
docker compose logs backend | grep -i migration
```

To run migrations manually:

```bash
docker compose exec backend python manage.py migrate
```

### `django.db.OperationalError: could not connect to server`

The backend started before the database was ready. The healthcheck in docker-compose.yml should prevent this, but if it happens:

```bash
docker compose restart backend
```

### Push notifications not delivered

1. Verify VAPID keys are set (see above).
2. Check that the user has granted browser notification permissions.
3. Check Celery logs for push-related errors.
4. Ensure the domain matches the one used when generating VAPID keys.

### User cannot log in

1. Check that the user exists in Django Admin: `https://nudge.naseira.es/api/admin/`
2. Reset password from Django Admin if needed.
3. Check backend logs for auth errors.

---

## Database shell

```bash
docker compose exec db psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

## Django shell

```bash
docker compose exec backend python manage.py shell
```

## Check environment variables loaded by the backend

```bash
docker compose exec backend env | sort
```
