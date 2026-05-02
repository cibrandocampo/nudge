# Upgrading Nudge

## v1.x → v2.0.0 — Breaking change: Postgres 16 → 17

v2.0.0 ships Postgres 17. Postgres refuses to start on a data directory
initialized by a different major version, so **a direct `docker compose pull
&& docker compose up -d` will leave the database container crash-looping**.
You must run the migration script first.

### Prerequisites

- A recent successful `pg_dump` backup (verify via your cron log before
  proceeding — see [docs/backup.md](backup.md)).
- Free disk on the host for two extra volumes worth of data: the live
  volume, a safety snapshot (`<volume>_pre17`), and the dump file (typically
  well under 1 GB for a personal-scale instance).
- The containers must be **running on PG16** when you start the script.
  Do not pull new images before running it.
- `POSTGRES_USER`, `POSTGRES_DB`, and `POSTGRES_PASSWORD` must be set in
  `.env` (they always are in a working installation).

### Run the script

```bash
# From the directory that contains docker-compose.yml and .env
./scripts/upgrade-postgres.sh
```

The script is fully automated:

1. Checks that the running Postgres major is 16 (refuses otherwise).
2. Stops `backend` and `celery` to quiesce writes.
3. Dumps the database in custom format to `/tmp/nudge-pg-upgrade-<timestamp>.dump`.
4. Snapshots the data volume into `<volume>_pre17` for safety.
5. Drops the original volume and recreates it empty so PG17 can `initdb`.
6. Pulls and starts Postgres 17, waits for `pg_isready`.
7. Restores the dump.
8. Restarts `backend` and `celery`.
9. Runs `python manage.py check` as a smoke-test.

Total downtime is typically **2–5 minutes** on a personal-scale instance.

### Bind-mount volumes (Synology NAS and similar)

If your `DATA_PATH` in `.env` points to a host directory (the default Synology
setup uses an absolute path like `/volume1/docker/tools/nudge/data`), the Docker
volume is a bind mount. When the script drops and recreates the Docker volume
the underlying directory on the host is **not** wiped, so Postgres 17 finds the
PG16 files and refuses to start.

If you hit this, the dump is already on disk — complete the migration manually:

```bash
# 1. Stop and remove the broken PG17 container
docker stop nudge-db && docker rm nudge-db

# 2. Wipe the PG16 data directory using a helper container
#    (cibran cannot rm these files — they are owned by uid 70, the postgres user)
docker run --rm \
  -v /path/to/your/data:/data \
  alpine sh -c 'rm -rf /data/* /data/.[!.]*'

# 3. Start PG17 — it will initdb on the now-empty directory
docker compose up -d db

# 4. Wait for readiness
until docker compose exec -T db pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do
  sleep 2
done

# 5. Restore the dump (check the timestamp in /tmp/)
docker compose exec -T db pg_restore \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --no-owner --clean --if-exists \
  < /tmp/nudge-pg-upgrade-<timestamp>.dump

# 6. Bring the rest of the stack back up
docker compose start backend celery

# 7. Smoke-test
docker compose exec -T backend python manage.py check
```

### After validation

Use the app for a few days. Confirm the nightly `pg_dump` cron still succeeds
and spot-check a routine completion plus a stock decrement to confirm data
integrity. Then reclaim disk:

```bash
docker volume rm <volume>_pre17      # printed by the script on completion
rm /tmp/nudge-pg-upgrade-*.dump
```

### Rollback

If anything goes wrong before you delete the snapshot, the script's final
output prints exact rollback commands. The short version:

```bash
docker compose stop backend celery
docker compose rm -f db
docker volume rm nudge_postgres_data
docker volume create nudge_postgres_data
docker run --rm \
  -v nudge_postgres_data_pre17:/from:ro \
  -v nudge_postgres_data:/to \
  alpine sh -c 'cp -a /from/. /to/'
DOCKER_POSTGRES_VERSION=16-alpine docker compose up -d db
docker compose start backend celery
```

The dump file at `/tmp/nudge-pg-upgrade-<timestamp>.dump` is a second
independent recovery path — it can be restored into any fresh PG16 instance.

### Redeploy after the migration

Once the script (or the manual steps above) completes successfully, do the
normal redeploy to pull the v2.0.0 app images:

```bash
docker compose pull
docker compose up -d
```
