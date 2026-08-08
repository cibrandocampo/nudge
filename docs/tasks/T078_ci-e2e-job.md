# T078 — Job de CI `test-e2e` con chromium-preview

## Context

Hallazgo T1 de `docs/technical-review.md`: existen 27+ specs Playwright
maduros pero `ci.yml` solo corre unit tests. La regresión T049→T052 (cambio de
forma del formulario que rompió dos specs en silencio) demostró el coste.
Plan: `docs/plans/technical-review-remediation.md`, oleada I. Es además la red
de seguridad exigida antes de la migración de auth (T083).

**Dependencies**: None.

## Objective

Cada PR a `main` ejecuta la suite `chromium-preview` (los 18 specs
históricamente estables) contra el stack real levantado en el runner; un fallo
bloquea el merge.

## Step 1 — Job en `ci.yml`

Nuevo job `test-e2e` (paralelo a `test-backend`/`test-frontend`; los jobs de
build pueden seguir dependiendo solo de los unit — decisión: e2e como gate de
PR, no de build):

1. Checkout + crear `.env` desde `.env.example` con los valores de dev
   (`DJANGO_DEBUG=True`, `E2E_SEED_ALLOWED=true`, passwords de CI).
2. `docker compose --env-file .env -f dev/docker-compose.yml --profile preview up -d --build db redis backend celery frontend-preview` y esperar healthchecks
   (`docker compose … wait` o bucle sobre `/api/health/`).
3. Migrar + seed (`exec backend python manage.py migrate && … seed`).
4. `docker build -f e2e/Dockerfile -t nudge-e2e ./e2e`.
5. `docker run --rm --network host -e BASE_URL=http://localhost:14173 -e E2E_USERNAME=admin -e E2E_PASSWORD=adminpass -e DEMO_USERS_PASSWORD=… nudge-e2e npx playwright test --project=chromium-preview`.
6. En fallo: subir `playwright-report`/traces como artifact
   (`actions/upload-artifact`).

Los specs `chromium-dev` con flakiness conocida (MEMORY.md) quedan **fuera**
del gate hasta resolver su causa raíz — no se meten con `--retries`.

## Step 2 — Ajustes de tiempo y caché

- Cachear la build de la imagen e2e (`docker/build-push-action` con cache de
  GitHub o `actions/cache` sobre buildx) para que el job quede < ~10 min.
- `timeout-minutes` en el job (p. ej. 20) para que un cuelgue no consuma una
  hora de runner.

## Step 3 — Verificación

Abrir un PR de prueba (puede ser el de esta misma tarea): el job corre y pasa.
Introducir temporalmente un fallo local (no pushear) para confirmar que el
reporte y los artifacts funcionan, o verificarlo con un spec filtrado a un
test inexistente.

## DoD — Definition of Done

1. El PR de esta tarea muestra el job `test-e2e` en verde en GitHub Actions.
2. 18/18 specs preview pasan en el runner.
3. En caso de fallo se publican artifacts con el reporte (verificado al menos una vez).
4. Duración del job < 20 min con `timeout-minutes` configurado.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Run de CI | `gh run view <run-id> --log 2>&1 \| grep -E 'passed\|failed' \| tail -5` | `ci_run.txt` | "18 passed" |
| 2 | Duración | `gh run view <run-id> --json jobs --jq '.jobs[] \| select(.name=="test-e2e") \| .startedAt,.completedAt'` | `duration.txt` | < 20 min |

## Files to create/modify

| File | Action |
|------|--------|
| `.github/workflows/ci.yml` | MODIFY |
| `dev/docker-compose.yml` | MODIFY (solo si falta healthcheck para el wait) |
