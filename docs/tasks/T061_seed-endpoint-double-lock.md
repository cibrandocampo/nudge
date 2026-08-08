# T061 — Doble candado del endpoint de seed

## Context

Hallazgo S3 de `docs/technical-review.md`: `POST /api/internal/seed/`
(`backend/apps/core/views.py:45-52`) es `AllowAny` y su único guard es
`DEBUG or E2E_SEED_ALLOWED=true`. Si esa env var se cuela en un `.env` de
producción, cualquiera puede destruir y resembrar la base de datos sin
credenciales. Plan: `docs/plans/technical-review-remediation.md`, oleada C.

**Dependencies**: None.

## Objective

El endpoint de seed no existe en producción (la URL no se registra) y el
comando `seed` se niega a ejecutarse contra una base que parezca real, incluso
invocado por management command.

## Step 1 — Registro condicional de la URL

En `backend/apps/core/urls.py`, registrar `internal/seed/` solo cuando
`settings.DEBUG or env E2E_SEED_ALLOWED` (la condición actual de la vista,
movida al momento de definición de URLs). En producción sin la env var, la
ruta devuelve 404 de Django — no hay superficie que golpear. La comprobación
dentro de `SeedView.post` se mantiene (defensa en profundidad; el proceso pudo
arrancar con otra configuración).

Cuidado con los tests: el URLconf se resuelve al importar; los tests que
ejercitan el 403 actual deben pasar a usar `override_settings` +
`django.urls.clear_url_caches()` o testear el nuevo comportamiento (404 en
prod-config, 204 en dev-config).

## Step 2 — Guard anti-producción en el comando `seed`

En `backend/apps/core/management/commands/seed.py`, al inicio del `handle`:

```python
real_users = User.objects.filter(auth_method="otp").count()
if real_users > 10 and not options.get("force"):
    raise CommandError(
        f"Refusing to seed: {real_users} OTP users found — this looks like a "
        "real database. Pass --force to override."
    )
```

Añadir el flag `--force` para el caso legítimo. Umbral 10: los usuarios demo
del seed son `auth_method="password"` (`seed.py:149-183`), así que cualquier
volumen de usuarios OTP indica signups reales.

## Step 3 — Tests

1. Con configuración de producción (sin DEBUG, sin `E2E_SEED_ALLOWED`):
   `POST /api/internal/seed/` → 404.
2. Con `E2E_SEED_ALLOWED=true`: → 204 y la base se resembra.
3. Comando `seed` con >10 usuarios OTP → `CommandError`; con `--force` →
   ejecuta.
4. El flujo E2E no se rompe: `global-setup.js` sigue pudiendo resembrar
   (usa la env var, que el compose de dev define).

## DoD — Definition of Done

1. Suite backend completa en verde: `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test`.
2. Los 3 escenarios del paso 3 tienen test propio.
3. Suite E2E `chromium-preview` en verde (el seed de arranque sigue funcionando).
4. `ruff check .` limpio.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Tests backend | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test apps.core 2>&1 \| tail -5` | `core_tests.txt` | "OK", 0 failures |
| 2 | Guard del comando | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test apps.core -v 2 2>&1 \| grep -i seed` | `seed_guard_tests.txt` | Tests del guard listados como ok |
| 3 | E2E preview | `docker run --rm --network host … nudge-e2e npx playwright test --project=chromium-preview 2>&1 \| tail -5` | `e2e_preview.txt` | 0 failed |

## Files to create/modify

| File | Action |
|------|--------|
| `backend/apps/core/urls.py` | MODIFY |
| `backend/apps/core/views.py` | MODIFY |
| `backend/apps/core/management/commands/seed.py` | MODIFY |
| `backend/apps/core/tests.py` | MODIFY |
