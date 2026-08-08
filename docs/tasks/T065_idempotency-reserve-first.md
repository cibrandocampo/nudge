# T065 — Idempotencia reserva-primero: eliminar la ventana de carrera

## Context

Hallazgo C2 (rojo) de `docs/technical-review.md`: el middleware
(`backend/apps/idempotency/middleware.py:63-85`) hace *get → ejecutar vista →
create*. Dos peticiones concurrentes con la misma `Idempotency-Key` pasan
ambas el `DoesNotExist` y ejecutan la vista dos veces — doble decremento de
stock. El `IntegrityError` capturado solo dedupe el registro, no la ejecución.
Plan: `docs/plans/technical-review-remediation.md`, oleada D.

**Dependencies**: T064 (el cliente ya trata 409 como reintentable; desplegar
T064 antes o en la misma release).

## Objective

Con la misma clave, exactamente una petición ejecuta la vista; las demás
reciben la respuesta cacheada (si terminó) o 409 + `Retry-After` (si está en
vuelo). Sin ventana de carrera.

## Step 1 — Campo `status` en el modelo

En `backend/apps/idempotency/models.py`:

```python
STATUS_CHOICES = [("in_progress", "In progress"), ("completed", "Completed")]
status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="completed")
```

`response_status`/`response_body` pasan a `null=True` (una reserva
`in_progress` aún no tiene respuesta). Migración: filas existentes quedan
`completed` (el default las cubre; verificar con la migración generada).

## Step 2 — Invertir el orden en el middleware

Nuevo flujo en `__call__`:

1. **Reserva**: `IdempotencyRecord.objects.create(status="in_progress", …)`
   en su propia `transaction.atomic()`. La unique `(user, key)` decide.
2. **Ganador** (create OK): ejecuta `self.get_response(request)`.
   - 2xx → actualizar la fila a `completed` con status/body.
   - No-2xx o excepción → **borrar** la reserva (los errores no se cachean,
     igual que hoy; el `finally` garantiza que no quedan reservas huérfanas
     del camino de error).
3. **Perdedor** (`IntegrityError`): releer la fila.
   - `completed` → devolver la respuesta cacheada (validando `body_hash`
     como hoy; mismatch → 422).
   - `in_progress` → `JsonResponse({"error": "in_progress"}, status=409)`
     con header `Retry-After: 1`.

El check de `body_hash` para claves reusadas con body distinto se mantiene en
ambos estados.

## Step 3 — Purga de reservas huérfanas

Si el proceso muere entre reserva y completado (kill -9, OOM), la clave queda
`in_progress` para siempre y el cliente recibiría 409 eternos. En
`apps/idempotency/tasks.py`, `cleanup_idempotency_records` purga además
`in_progress` con `created_at` > **15 minutos** (decisión del plan: muy por
encima del timeout de gunicorn, muy por debajo de la retención de 24 h).

## Step 4 — Tests

1. Carrera real: dos hilos con la misma clave y body contra un endpoint
   contado (p. ej. una vista de test que incrementa un contador, o
   `routines/log`) → la vista ejecuta **una** vez; un hilo recibe la
   respuesta, el otro 409 o la cacheada. Usar `threading` +
   `TransactionTestCase` (las transacciones por hilo lo exigen).
2. Reserva `in_progress` existente → nueva petición misma clave → 409 con
   `Retry-After`.
3. Registro `completed` → replay devuelve cacheado sin ejecutar la vista
   (contador no sube).
4. Vista que lanza excepción → la reserva desaparece; un reintento ejecuta de
   nuevo.
5. La tarea de limpieza purga `in_progress` viejos y respeta los recientes.
6. Body distinto con la misma clave → 422 en ambos estados.

## DoD — Definition of Done

1. Suite backend completa en verde: `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test`.
2. El test de carrera (2 hilos, 1 ejecución) pasa 3 veces seguidas.
3. Migración aplicada y reversible.
4. Suite E2E `chromium-preview` en verde (las mutaciones normales no cambian de contrato).
5. `ruff check .` limpio.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Tests idempotency ×3 | `for i in 1 2 3; do docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test apps.idempotency; done 2>&1 \| grep -E 'OK\|FAILED'` | `idempotency_x3.txt` | 3× OK |
| 2 | Suite completa | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test 2>&1 \| tail -5` | `backend_tests.txt` | "OK", 0 failures |
| 3 | E2E preview | `docker run --rm --network host … nudge-e2e npx playwright test --project=chromium-preview 2>&1 \| tail -5` | `e2e_preview.txt` | 0 failed |

## Files to create/modify

| File | Action |
|------|--------|
| `backend/apps/idempotency/models.py` | MODIFY |
| `backend/apps/idempotency/migrations/0002_status.py` | CREATE (generada) |
| `backend/apps/idempotency/middleware.py` | MODIFY |
| `backend/apps/idempotency/tasks.py` | MODIFY |
| `backend/apps/idempotency/tests.py` | MODIFY |
