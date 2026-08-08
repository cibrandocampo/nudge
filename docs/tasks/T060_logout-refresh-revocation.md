# T060 — Logout con revocación del refresh token

## Context

Hallazgo S1 (fase 1) de `docs/technical-review.md`: `AuthContext.logout()`
solo borra `localStorage`; el refresh token sigue siendo válido en el servidor
durante hasta 60 días. La app `rest_framework_simplejwt.token_blacklist` ya
está instalada (`settings.py:41`) pero solo actúa en la rotación. Plan:
`docs/plans/technical-review-remediation.md`, oleada C. T081 (cookie httpOnly)
construirá sobre este endpoint.

**Dependencies**: None.

## Objective

Cerrar sesión revoca el refresh token en el servidor; un refresh posterior con
ese token devuelve 401.

## Step 1 — Endpoint de logout

En `backend/apps/users/views.py`, vista `logout` (`POST /api/auth/logout/`,
autenticada):

```python
@api_view(["POST"])
def logout(request):
    refresh = request.data.get("refresh", "")
    try:
        RefreshToken(refresh).blacklist()
    except TokenError:
        pass  # ya inválido/expirado — logout es idempotente
    return Response(status=status.HTTP_204_NO_CONTENT)
```

Registrar en `backend/apps/users/urls.py` como `logout/`. Decisión de diseño:
logout **nunca falla** hacia el cliente (204 incluso con token inválido) — el
objetivo es revocar si se puede y no bloquear jamás la salida del usuario.

## Step 2 — Llamada desde el frontend

En `frontend/src/contexts/AuthContext.jsx`, `logout()`:

1. Leer `refresh_token` de `localStorage`.
2. `api.post('/auth/logout/', { refresh })` **fire-and-forget** (catch
   silencioso: si está offline, la limpieza local procede igual; el token
   expirará por su cuenta).
3. La limpieza local existente (tokens + `setQueryData(['me'], null)`) se
   mantiene tal cual y se ejecuta sin esperar a la red.

## Step 3 — Tests

Backend (`apps.users`):
1. Logout con refresh válido → 204 y el refresh queda blacklisteado
   (`POST /api/auth/refresh/` con él → 401).
2. Logout con token basura → 204 (idempotente).
3. Logout sin autenticación → 401.

Frontend:
4. `logout()` dispara el POST con el refresh y limpia el estado aunque el POST
   rechace (mock de `OfflineError`).

## DoD — Definition of Done

1. Suite backend en verde: `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test apps.users` y suite completa.
2. `docker compose --env-file .env -f dev/docker-compose.yml exec frontend npx vitest run` en verde.
3. Verificación manual en dev: login → logout → intentar `POST /api/auth/refresh/` con el refresh viejo (curl) → 401.
4. Lint/format limpios en ambos stacks.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Tests backend | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test apps.users 2>&1 \| tail -5` | `users_tests.txt` | "OK", 0 failures |
| 2 | Tests frontend | `docker compose --env-file .env -f dev/docker-compose.yml exec frontend npx vitest run 2>&1 \| tail -10` | `vitest.txt` | 0 failed |
| 3 | Revocación real | `curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:18000/api/auth/refresh/ -H 'Content-Type: application/json' -d '{"refresh":"<token tras logout>"}'` | `revoked_401.txt` | 401 |

## Files to create/modify

| File | Action |
|------|--------|
| `backend/apps/users/views.py` | MODIFY |
| `backend/apps/users/urls.py` | MODIFY |
| `backend/apps/users/tests.py` | MODIFY |
| `frontend/src/contexts/AuthContext.jsx` | MODIFY |
| `frontend/src/contexts/__tests__/AuthContext.test.jsx` | MODIFY |
