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

## Major version upgrade

Postgres major version bumps (e.g. 16 → 17) require a dump/restore cycle — the new image refuses to start on a data directory initialized by the previous major. Use [`scripts/upgrade-postgres.sh`](../scripts/upgrade-postgres.sh) on the NAS during a planned downtime window.

### Prerequisites

- A recent successful nightly `pg_dump` (verify via the cron log).
- The repo at the commit that ships the new default (`DOCKER_POSTGRES_VERSION:-17-alpine` in `docker-compose.yml`).
- Free disk on the NAS for two volumes (the live one + the snapshot taken by the script) and the dump file (typically `<200MB` for a personal-scale Nudge instance).
- `.env` on the NAS containing `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`.

### Run

From the repo root on the NAS:

```bash
./scripts/upgrade-postgres.sh
```

The script:

1. Pre-checks that the running Postgres major is 16 (refuses otherwise).
2. Stops `backend` and `celery` to quiesce writes.
3. Dumps `$POSTGRES_DB` in custom format to `/tmp/nudge-pg-upgrade-<timestamp>.dump`.
4. Snapshots the data volume into `<volume>_pre17` for safety.
5. Drops the original volume so PG17 can `initdb` cleanly.
6. Brings up Postgres 17 on the empty volume and waits for `pg_isready`.
7. Restores the dump.
8. Restarts `backend` and `celery`.
9. Runs `python manage.py check` as a smoke-test.

Total downtime is typically `2–5 min` on a personal-scale instance — pg_dump and pg_restore are I/O-bound on a single Nudge user's data set.

### After validation

Use the app for a few days, confirm the nightly `pg_dump` cron still succeeds, and spot-check a routine completion plus a stock decrement to confirm the data round-tripped intact. Then free the disk:

```bash
docker volume rm <volume>_pre17
rm /tmp/nudge-pg-upgrade-*.dump
```

The script prints the exact `<volume>` name on completion (it varies between prod `nudge_postgres_data` and dev `dev_postgres_data`).

### Rollback

If the upgrade fails or the app misbehaves on PG17, the script's final output prints the exact rollback commands. They restore the snapshot back into the original volume and bring up PG16 again. The dump file is also a second recovery path: it can be restored into a fresh PG16 instance.

### Future major bumps (17 → 18, etc.)

The script is hardcoded to the 16 → 17 jump (precheck refuses any other source major, snapshot suffix is `_pre17`). When the next major lands, fork the script with the new versions and rename the snapshot suffix accordingly — or accept overrides via `NEW_PG_VERSION` and `SNAPSHOT_SUFFIX` env vars (already supported), but still bump the precheck constant in source.
