# T054 — Higiene de repo: .gitignore para secretos y artefactos, borrado de residuos

## Context

La revisión técnica (hallazgos S7 y Q4 de `docs/technical-review.md`) encontró
tres residuos en el árbol de trabajo que no están en git pero que nada impide
commitear por accidente: `backend/private_key.pem` y `backend/public_key.pem`
(claves VAPID), `backend/celerybeat-schedule` (artefacto de ejecución de
Celery beat) y el directorio `frontend/e2e/` (duplicado local confuso del
`e2e/` raíz real). Plan: `docs/plans/technical-review-remediation.md`, oleada A.

**Dependencies**: None.

## Objective

Que un `git add .` desde cualquier directorio no pueda introducir claves
privadas ni artefactos de ejecución, y que el árbol de trabajo no contenga
residuos que confundan a un colaborador nuevo.

## Step 1 — Ampliar `.gitignore`

Añadir al `.gitignore` raíz (en la sección de secretos si existe, o creando
una sección `# Secrets and runtime artifacts`):

```
*.pem
celerybeat-schedule
```

Comprobar antes que ningún `.pem` está trackeado (debe salir vacío):

```bash
git ls-files | grep -E '\.pem$|celerybeat-schedule'
```

## Step 2 — Borrar los residuos del árbol de trabajo

```bash
rm backend/private_key.pem backend/public_key.pem backend/celerybeat-schedule
rm -rf frontend/e2e/
```

Antes de borrar los `.pem`, verificar que las claves VAPID activas están en
`.env` (`VAPID_PRIVATE_KEY` / `VAPID_PUBLIC_KEY`): los ficheros son la salida
histórica de `manage.py generate_vapid_keys`, no la fuente de configuración.
Si `.env` no las tuviera, copiarlas ahí ANTES de borrar.

`frontend/e2e/` no está trackeado (verificado con `git ls-files frontend/e2e`
→ vacío); el E2E real vive en `e2e/` raíz.

## Step 3 — Verificar que la ignorancia funciona

```bash
touch backend/test_dummy.pem && git status --porcelain | grep dummy ; rm backend/test_dummy.pem
```

El `grep` no debe producir salida (el fichero queda ignorado).

## DoD — Definition of Done

1. `git ls-files | grep -E '\.pem$|celerybeat-schedule'` no devuelve nada.
2. `git check-ignore backend/private_key.pem backend/celerybeat-schedule` responde ambas rutas (exit 0).
3. No existen `backend/*.pem`, `backend/celerybeat-schedule` ni `frontend/e2e/` en el árbol.
4. El backend arranca con normalidad tras el borrado: `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py check` sin errores (las claves VAPID salen de `.env`, no de los `.pem`).

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Ignore activo | `git check-ignore -v backend/private_key.pem backend/celerybeat-schedule 2>&1` | `gitignore_check.txt` | Ambas rutas matchean una regla de `.gitignore` |
| 2 | Residuos eliminados | `ls backend/*.pem backend/celerybeat-schedule frontend/e2e 2>&1` | `residues_gone.txt` | "No such file or directory" para las tres rutas |
| 3 | Backend sano | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py check 2>&1` | `django_check.txt` | "System check identified no issues" |

## Files to create/modify

| File | Action |
|------|--------|
| `.gitignore` | MODIFY |
| `backend/private_key.pem` | DELETE (working tree; nunca estuvo en git) |
| `backend/public_key.pem` | DELETE (working tree; nunca estuvo en git) |
| `backend/celerybeat-schedule` | DELETE (working tree) |
| `frontend/e2e/` | DELETE (directorio local no trackeado) |
