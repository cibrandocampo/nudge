# T071 — Push de sharing y contactos fuera del ciclo request/response

## Context

Hallazgo A5 de `docs/technical-review.md`: `StockViewSet.update`,
`RoutineViewSet.update` y `contact_list_create` llaman a
`notify_stock_shared` / `notify_routine_shared` / `notify_contact_added`, que
ejecutan `webpush()` — HTTP a los servidores de push de Google/Mozilla/Apple —
**en línea**, una petición por dispositivo suscrito
(`apps/notifications/push.py:128-168`). Un endpoint push lento añade segundos
a un PATCH; un fallo de red puede convertirse en 500. Los recordatorios ya van
por Celery: la asimetría es un descuido. Plan:
`docs/plans/technical-review-remediation.md`, oleada G.

**Dependencies**: None.

## Objective

Ningún `webpush()` se ejecuta dentro de un request HTTP; los push de
sharing/contactos se despachan a Celery.

## Step 1 — Tareas Celery

En `backend/apps/notifications/tasks.py`, tres tareas finas que reciben PKs
(nunca objetos — serialización JSON del broker):

```python
@shared_task
def send_stock_shared_push(stock_id, user_id): ...
@shared_task
def send_routine_shared_push(routine_id, user_id): ...
@shared_task
def send_contact_added_push(requester_id, target_id): ...
```

Cada tarea recarga los objetos (`.filter(...).first()`, saliendo en silencio
si ya no existen — el share pudo deshacerse antes de que el worker corriera) y
llama al `notify_*` existente de `push.py`, que no cambia.

## Step 2 — Despacho con `.delay()` tras commit

En los tres call sites (`routines/views.py:94-97` y `264-267`,
`users/views.py:215`), sustituir la llamada directa por
`transaction.on_commit(lambda: send_…​.delay(...))` — el worker no debe correr
antes de que el share esté commiteado (carrera clásica: la tarea lee la DB y
el M2M aún no existe).

Nota: si la oleada E (T066) ya movió estos call sites a servicios, aplicar el
cambio donde vivan ahora — el anclaje es la llamada a `notify_*`, no el
fichero.

## Step 3 — Tests

Con `CELERY_TASK_ALWAYS_EAGER` (ya activo en tests) las tareas corren en
línea, así que los tests existentes de "compartir notifica" siguen pasando —
ese es el guardarraíl. Añadir:

1. Test de que el despacho va vía tarea (mock de `send_stock_shared_push.delay`
   asertando args) — fija el cableado.
2. Tarea con `stock_id` inexistente → no lanza (sale en silencio).
3. `on_commit`: usar `TestCase.captureOnCommitCallbacks` para verificar que el
   despacho ocurre tras el commit.

## DoD — Definition of Done

1. Suite backend completa en verde.
2. `grep -rn "notify_stock_shared\|notify_routine_shared\|notify_contact_added" backend/apps/*/views.py backend/apps/*/services.py` no muestra llamadas directas (solo los `.delay` de las tareas).
3. Verificación manual en dev: compartir un stock con un usuario demo con el worker celery levantado → la notificación llega (logs del worker la muestran).
4. `ruff check .` limpio.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Suite completa | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test 2>&1 \| tail -5` | `backend_tests.txt` | "OK", 0 failures |
| 2 | Sin push en línea | `grep -rn "notify_.*shared\|notify_contact" backend/apps/routines/ backend/apps/users/ --include='*.py' \| grep -v test \| grep -v tasks` | `no_inline_push.txt` | Solo despachos `.delay` |
| 3 | Worker procesa | `docker compose --env-file .env -f dev/docker-compose.yml logs celery 2>&1 \| grep -i "shared_push" \| tail -5` | `celery_log.txt` | Tarea recibida y ejecutada |

## Files to create/modify

| File | Action |
|------|--------|
| `backend/apps/notifications/tasks.py` | MODIFY |
| `backend/apps/routines/views.py` (o `services.py` post-T066) | MODIFY |
| `backend/apps/users/views.py` | MODIFY |
| `backend/apps/notifications/tests.py` | MODIFY |
