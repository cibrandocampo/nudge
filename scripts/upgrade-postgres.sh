#!/usr/bin/env bash
# scripts/upgrade-postgres.sh — One-shot Postgres major upgrade for
# the Nudge stack. Reads .env from the current directory and assumes
# the compose file at $COMPOSE_FILE (default: docker-compose.yml).
#
# Procedure:
#   1. Pre-check  — running Postgres major must be 16.
#   2. Dump       — pg_dump in custom format to $DUMP_FILE.
#   3. Stop db    — bring down the db service.
#   4. Snapshot   — copy old volume to <name>_pre17 for safety.
#   5. Reset      — drop the original volume so PG17 can initdb.
#   6. Bring up   — DOCKER_POSTGRES_VERSION=17-alpine compose up -d db.
#   7. Wait       — poll pg_isready until the new db is ready.
#   8. Restore    — pg_restore the custom dump into the empty PG17 db.
#   9. Resume     — start backend + celery.
#  10. Smoke-test — python manage.py check.
#
# Idempotent on failure:
#   - If pg_restore fails, the dump file is on disk; rerun manually.
#   - If PG17 fails to start, the *_pre17 volume is the recovery path.
#
# Usage:
#   ./scripts/upgrade-postgres.sh                 # uses docker-compose.yml
#   COMPOSE_FILE=dev/docker-compose.yml ./scripts/upgrade-postgres.sh

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
DUMP_DIR="${DUMP_DIR:-/tmp}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="${DUMP_DIR}/nudge-pg-upgrade-${TIMESTAMP}.dump"
NEW_PG_VERSION="${NEW_PG_VERSION:-17-alpine}"
SNAPSHOT_SUFFIX="${SNAPSHOT_SUFFIX:-pre17}"

dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

log() { printf '→ %s\n' "$*"; }
err() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# ── Step 1: load .env ────────────────────────────────────────────────
[[ -f .env ]] || err ".env not found in $(pwd)"
set -a; source .env; set +a
: "${POSTGRES_USER:?POSTGRES_USER missing in .env}"
: "${POSTGRES_DB:?POSTGRES_DB missing in .env}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD missing in .env}"

# ── Step 2: precheck — running PG major must be 16 ──────────────────
log "Checking running Postgres major version..."
db_container="$(dc ps -q db || true)"
[[ -n "$db_container" ]] || err "No running 'db' container under $COMPOSE_FILE."

server_version_num="$(dc exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'SHOW server_version_num;' \
  | tr -d '[:space:]')"
running_major="${server_version_num:0:2}"

if [[ "$running_major" != "16" ]]; then
  err "Running Postgres major is '$running_major', expected '16'.
This script is scoped to the 16 → 17 upgrade only.
If you are already on PG17, no upgrade is needed."
fi

# Capture the volume name backing /var/lib/postgresql/data so the
# script works for both prod (nudge_postgres_data) and dev
# (dev_postgres_data) without hardcoding either.
volume_name="$(docker inspect "$db_container" \
  --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}')"
[[ -n "$volume_name" ]] || err "Could not resolve postgres data volume from container $db_container."
snapshot_volume="${volume_name}_${SNAPSHOT_SUFFIX}"
log "Source volume: $volume_name (snapshot will be $snapshot_volume)"

# Refuse to clobber an existing snapshot from a prior run.
if docker volume inspect "$snapshot_volume" >/dev/null 2>&1; then
  err "Snapshot volume '$snapshot_volume' already exists from a prior run.
Inspect it and remove with 'docker volume rm $snapshot_volume' before retrying."
fi

# ── Step 3: dump ─────────────────────────────────────────────────────
log "Quiescing app containers (backend, celery)..."
dc stop backend celery

log "Dumping $POSTGRES_DB to $DUMP_FILE ..."
dc exec -T db pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$DUMP_FILE"
dump_size="$(du -h "$DUMP_FILE" | cut -f1)"
log "  dump size: $dump_size"

# ── Step 4: snapshot the old volume ──────────────────────────────────
log "Stopping db so the volume can be safely copied..."
dc stop db

log "Creating snapshot volume $snapshot_volume and copying data..."
docker volume create "$snapshot_volume" >/dev/null
docker run --rm \
  -v "${volume_name}:/from:ro" \
  -v "${snapshot_volume}:/to" \
  alpine sh -c 'cp -a /from/. /to/'

# ── Step 5: drop the original volume so PG17 can initdb ─────────────
log "Removing original volume $volume_name (PG17 needs an empty dir to initdb)..."
dc rm -f db
docker volume rm "$volume_name" >/dev/null

# ── Step 6: bring up new image ──────────────────────────────────────
log "Starting Postgres $NEW_PG_VERSION on a fresh volume..."
DOCKER_POSTGRES_VERSION="$NEW_PG_VERSION" dc up -d db

# ── Step 7: wait for readiness ──────────────────────────────────────
log "Waiting for Postgres to accept connections..."
ready=0
for _ in $(seq 1 60); do
  if dc exec -T db pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[[ "$ready" -eq 1 ]] || err "Postgres did not become ready within 120s."

new_version="$(dc exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'SHOW server_version;' \
  | tr -d '[:space:]')"
log "  Postgres reports: $new_version"
[[ "$new_version" == 17.* ]] || err "Expected PG17, got $new_version."

# ── Step 8: restore ─────────────────────────────────────────────────
log "Restoring dump into PG17..."
dc exec -T db pg_restore \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --no-owner --clean --if-exists < "$DUMP_FILE"

# ── Step 9: bring app back up ───────────────────────────────────────
log "Starting backend + celery..."
dc start backend celery

# ── Step 10: smoke-test ─────────────────────────────────────────────
log "Running Django checks..."
dc exec -T backend python manage.py check

# ── Done ────────────────────────────────────────────────────────────
cat <<EOF

Upgrade complete. Postgres $new_version is live.

Artifacts kept for safety:
  - dump file:        $DUMP_FILE
  - snapshot volume:  $snapshot_volume

Validation checklist:
  - Smoke-test the app for a few days.
  - Confirm the nightly pg_dump cron still succeeds.
  - Spot-check a routine completion + a stock decrement to confirm
    the data round-tripped intact.

Once you trust the upgrade, free disk:
  docker volume rm $snapshot_volume
  rm $DUMP_FILE

If something is broken, restore PG16:
  docker compose -f $COMPOSE_FILE down db
  docker volume rm $volume_name
  docker volume create $volume_name
  docker run --rm \\
    -v ${snapshot_volume}:/from:ro \\
    -v ${volume_name}:/to \\
    alpine sh -c 'cp -a /from/. /to/'
  DOCKER_POSTGRES_VERSION=16-alpine docker compose -f $COMPOSE_FILE up -d db
  docker compose -f $COMPOSE_FILE start backend celery
EOF
