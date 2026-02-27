# Backup & Restore

## Database backup

The database lives in the `postgres_data` Docker volume. To back it up, run a `pg_dump` from inside the running container:

```bash
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup_$(date +%Y%m%d).sql
```

Copy the file off the NAS (e.g. via `scp`) and store it somewhere safe.

## Database restore

To restore from a dump file:

```bash
# Stop the app so no connections are open
docker compose stop backend celery

# Restore into the running db container
cat backup_20260101.sql | docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"

# Restart the app
docker compose start backend celery
```

## Full volume backup

As an alternative, you can stop all services and tar the volume directory directly on the host:

```bash
docker compose down
tar czf nudge_postgres_$(date +%Y%m%d).tar.gz /var/lib/docker/volumes/nudge_postgres_data
docker compose up -d
```

> The exact host path may differ depending on your Docker/Synology setup.

## Automated backups

Add a cron job on the NAS to run the `pg_dump` command nightly and rotate files older than 30 days:

```bash
# crontab -e (NAS admin user)
0 3 * * * cd /path/to/nudge && \
  docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
    > /volume1/backups/nudge/nudge_$(date +\%Y\%m\%d).sql && \
  find /volume1/backups/nudge/ -name "*.sql" -mtime +30 -delete
```

## What is NOT backed up

- Redis data (queues, rate-limit state). Redis is ephemeral — no data loss if it restarts.
- Frontend static files. These are rebuilt from source on every deploy.
- VAPID keys and secrets. These are in the `.env` file — back that file up separately and keep it secure.
