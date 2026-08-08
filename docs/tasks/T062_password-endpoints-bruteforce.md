# T062 — Protección de fuerza bruta en endpoints de contraseña

## Context

Hallazgo S4 de `docs/technical-review.md`: `change_password`
(`backend/apps/users/views.py:145-157`) no tiene throttle — una sesión robada
puede probar contraseñas sin límite — y el camino password de `login_verify`
solo tiene throttle por IP (10/min), sin lockout por cuenta como sí tiene OTP
(`LoginCode.attempts >= 5`). Plan: `docs/plans/technical-review-remediation.md`,
oleada C. Decisión delegada del plan: el contador se implementa como **modelo
dedicado con ventana temporal**, simétrico a `LoginCode`.

**Dependencies**: None.

## Objective

Ni `change_password` ni el login por contraseña permiten más de un puñado de
intentos fallidos por cuenta en una ventana de tiempo, con tests que fijan los
umbrales.

## Step 1 — Throttle en `change_password`

Añadir un `UserRateThrottle` con scope propio:

```python
class ChangePasswordThrottle(UserRateThrottle):
    scope = "change_password"
```

Rate en `settings.py`: `"change_password": "9999/minute" if DEBUG else "5/hour"`
(mismo patrón DEBUG-aware que las demás rates, `settings.py:178-191`).
Aplicar con `@throttle_classes([ChangePasswordThrottle])`.

## Step 2 — Lockout por cuenta en login por contraseña

Modelo `FailedLoginAttempt` en `apps/users/models.py`:

```python
class FailedLoginAttempt(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="failed_logins")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["user", "created_at"])]
```

Lógica en `login_verify` (camino password, `views.py:129-132`):

- Antes de `check_password`: si el usuario acumula ≥ 5 filas en los últimos
  15 minutos → 429 `{"error": "locked"}` (o 400 con código `locked`; elegir
  429 por semántica y documentarlo).
- `check_password` falla → crear fila y responder `invalid` como hoy.
- `check_password` acierta → borrar las filas del usuario (reset).

Constantes `LOGIN_LOCKOUT_ATTEMPTS = 5` / `LOGIN_LOCKOUT_WINDOW` en
`services.py`, junto a `OTP_MAX_ATTEMPTS` para que las políticas convivan a la
vista. Limpieza: extender la tarea diaria `cleanup_login_codes`
(`apps/users/tasks.py`) para purgar también `FailedLoginAttempt` viejos.

## Step 3 — Migración y tests

`makemigrations users` + `migrate` (vía `exec backend python manage.py …`).

Tests (`apps.users`):
1. 5 fallos de password en la ventana → el 6º intento devuelve `locked`
   aunque la contraseña sea correcta.
2. Login correcto tras 4 fallos → entra y resetea el contador.
3. `change_password`: el 6º intento en la hora → 429 (usar
   `override_settings` para una rate pequeña testeable o simular el throttle).
4. El lockout NO afecta al camino OTP (que tiene su propio mecanismo).
5. La tarea de limpieza purga intentos antiguos.

## DoD — Definition of Done

1. Suite backend completa en verde: `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test`.
2. Migración única y reversible: `python manage.py migrate users <anterior>` y re-migrate funcionan.
3. Los 5 tests del paso 3 existen.
4. Frontend sin cambios necesarios: verificación manual de que un `locked` en login muestra el error genérico de credenciales (aceptable) — si la UX resultara confusa, anotar follow-up, no ampliar el alcance aquí.
5. `ruff check .` limpio.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Tests users | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test apps.users 2>&1 \| tail -5` | `users_tests.txt` | "OK", 0 failures |
| 2 | Tests lockout | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test apps.users -v 2 2>&1 \| grep -iE 'lock\|throttle'` | `lockout_tests.txt` | Tests listados como ok |
| 3 | Migración | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py showmigrations users 2>&1 \| tail -5` | `migrations.txt` | Nueva migración aplicada [X] |

## Files to create/modify

| File | Action |
|------|--------|
| `backend/apps/users/models.py` | MODIFY (`FailedLoginAttempt`) |
| `backend/apps/users/migrations/00XX_failedloginattempt.py` | CREATE (generada) |
| `backend/apps/users/views.py` | MODIFY (`login_verify`, `change_password`) |
| `backend/apps/users/throttles.py` | MODIFY (`ChangePasswordThrottle`) |
| `backend/apps/users/services.py` | MODIFY (constantes de lockout) |
| `backend/apps/users/tasks.py` | MODIFY (limpieza) |
| `backend/nudge/settings.py` | MODIFY (rate nueva) |
| `backend/apps/users/tests.py` | MODIFY |
