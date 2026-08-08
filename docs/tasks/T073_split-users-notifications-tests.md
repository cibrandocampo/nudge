# T073 — Trocear `users/tests.py` y `notifications/tests.py` en paquetes

## Context

Continuación de Q2 (`docs/technical-review.md`): `users/tests.py` (1.640
líneas) y `notifications/tests.py` (1.662) sufren el mismo problema que
routines a menor escala. Mismo método que T072. Plan:
`docs/plans/technical-review-remediation.md`, oleada G. Depende de T071 porque
esa tarea añade tests a notifications — trocear después evita conflicto.

**Dependencies**: T071.

## Objective

Ambas apps con paquete `tests/` por área; mismo recuento de tests pre/post;
cero cuerpos editados.

## Step 1 — Censo previo por app

`manage.py test apps.users -v 2` y `apps.notifications -v 2` → anotar
"Ran N tests" de cada una.

## Step 2 — Paquetes

```
backend/apps/users/tests/
    __init__.py
    test_auth_flow.py      # login_start, login_verify, OTP, lockout (T062)
    test_me_settings.py    # me, change_password, optimistic locking
    test_contacts.py       # contactos + privacidad (T063)
    test_services.py       # services.py: username, issue/verify OTP, signup
    test_admin_access.py   # admin_access, throttles

backend/apps/notifications/tests/
    __init__.py
    test_push.py           # send_push_notification, helpers notify_*
    test_worker.py         # check_notifications, quiet hours, daily heads-up
    test_subscriptions.py  # endpoints de suscripción
    test_tasks.py          # tareas de T071, cleanup
```

Reglas idénticas a T072: mover clases enteras, imports consolidados, borrar
los `tests.py` originales, reparto ajustable al contenido real.

## Step 3 — Verificación de equivalencia

Mismo "Ran N tests" por app, 0 failures; suite completa en verde.

## DoD — Definition of Done

1. Recuentos idénticos pre/post en ambas apps.
2. No existen `users/tests.py` ni `notifications/tests.py`; existen los paquetes.
3. Ningún módulo > ~800 líneas.
4. Suite completa en verde; cobertura ≥ 95 %.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Censos previos | `… test apps.users -v 2 \| tail -3; … test apps.notifications -v 2 \| tail -3` | `census_before.txt` | 2× "Ran N … OK" |
| 2 | Censos posteriores | ídem después | `census_after.txt` | Mismos N, OK |
| 3 | Suite completa | `… manage.py test 2>&1 \| tail -5` | `backend_tests.txt` | "OK", 0 failures |

## Files to create/modify

| File | Action |
|------|--------|
| `backend/apps/users/tests.py` | DELETE (movido) |
| `backend/apps/users/tests/` (5 módulos) | CREATE |
| `backend/apps/notifications/tests.py` | DELETE (movido) |
| `backend/apps/notifications/tests/` (4 módulos) | CREATE |
