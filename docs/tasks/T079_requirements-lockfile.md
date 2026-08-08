# T079 — Lockfile de backend con hashes: `requirements.in` + `requirements.lock`

## Context

Hallazgo S6 de `docs/technical-review.md` (primera mitad):
`backend/requirements.txt` usa rangos `~=` sin lockfile — dos builds de la
misma revisión pueden llevar dependencias distintas, y un release malicioso de
un paquete entra solo. El frontend ya tiene `package-lock.json`; el backend
no tiene equivalente. Plan: `docs/plans/technical-review-remediation.md`,
oleada I.

**Dependencies**: None.

## Objective

Los builds del backend instalan exactamente las versiones fijadas en un lock
con hashes; los rangos `~=` quedan como fuente de intención en
`requirements.in`.

## Step 1 — Reorganizar los ficheros

1. Renombrar `backend/requirements.txt` → `backend/requirements.in`
   (conservando los comentarios, especialmente el del cap de redis/kombu).
2. Generar el lock **dentro del contenedor** (mismo Python 3.13-slim que
   producción — los hashes dependen de la plataforma para wheels; usar
   `--generate-hashes` cubre sdist+wheels multiplataforma):

```bash
docker run --rm -v "$PWD/backend":/app -w /app python:3.13-slim sh -c \
  "pip install pip-tools && pip-compile --generate-hashes --output-file requirements.lock requirements.in"
```

3. Mismo tratamiento para `dev/requirements.txt` si contiene las herramientas
   de test/lint que CI instala (`dev/requirements.in` + lock, o incluirlo como
   `-c` constraint del principal — elegir lo más simple que cubra CI).

## Step 2 — Consumidores del lock

- `backend/Dockerfile`: `COPY requirements.lock .` +
  `pip install --no-cache-dir --require-hashes -r requirements.lock`.
- `.github/workflows/ci.yml` (job backend): instalar del lock; la cache key
  de pip pasa a `backend/requirements.lock`.
- `docs/development.md` / `docs/upgrade.md`: procedimiento de bump — editar
  `.in`, regenerar lock con el comando de arriba, commitear ambos.

## Step 3 — Verificación

- `docker build backend/` termina OK (los hashes casan).
- Suite backend en verde dentro del contenedor reconstruido.
- `pip install --require-hashes` falla en seco si se altera un hash (probar
  mutando uno localmente, sin commitear — demuestra que el candado muerde).

## DoD — Definition of Done

1. `backend/requirements.lock` existe, con hashes (`grep -c 'sha256:' backend/requirements.lock` > 50).
2. `docker build -t nudge-backend-lock backend/` OK.
3. CI del PR en verde instalando del lock.
4. `docs/` documenta el flujo de bump.
5. La imagen resultante pasa la suite: `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test` (tras rebuild del servicio backend).

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Lock con hashes | `grep -c "sha256:" backend/requirements.lock` | `lock_hashes.txt` | > 50 |
| 2 | Build OK | `docker build backend/ 2>&1 \| tail -3` | `build.txt` | Success |
| 3 | Suite en imagen nueva | `… exec backend python manage.py test 2>&1 \| tail -5` | `backend_tests.txt` | "OK" |

## Files to create/modify

| File | Action |
|------|--------|
| `backend/requirements.txt` | RENAME → `requirements.in` |
| `backend/requirements.lock` | CREATE (generado) |
| `backend/Dockerfile` | MODIFY |
| `.github/workflows/ci.yml` | MODIFY |
| `docs/development.md` | MODIFY (flujo de bump) |
