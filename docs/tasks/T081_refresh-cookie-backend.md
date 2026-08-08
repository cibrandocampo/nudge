# T081 — Backend: refresh token en cookie httpOnly con doble aceptación

## Context

Hallazgo S1 fase 2 de `docs/technical-review.md`: el refresh token (60 días)
vive en `localStorage` — cualquier XSS lo exfiltra. Precondición verificada en
el plan (`docs/plans/technical-review-remediation.md`, oleada J): la API es
mismo origen en todos los entornos (proxy Vite en dev, nginx en prod), así que
una cookie `SameSite=Strict` funciona sin CORS con credenciales. T060 ya creó
el logout con blacklist.

**⚠️ Releer contra el árbol actual**: T060/T062 habrán tocado
`users/views.py`; anclar por nombres de vista.

**Dependencies**: T060.

## Objective

El backend emite y acepta el refresh token vía cookie httpOnly, manteniendo
compatibilidad con el body durante el periodo de migración; ningún endpoint
devuelve el refresh en el body cuando el cliente ya habla cookie.

## Step 1 — Utilidad de cookie

En `apps/users/` (módulo `auth_cookies.py`):

```python
REFRESH_COOKIE = "nudge_refresh"

def set_refresh_cookie(response, token: str): ...   # httponly, secure=not DEBUG, samesite="Strict", path="/api/auth/", max_age=60d
def clear_refresh_cookie(response): ...
```

`path="/api/auth/"` acota la cookie a los endpoints de auth. `secure` ligado a
`not DEBUG` (dev corre en http).

## Step 2 — Emisión y aceptación

- `login_verify`: en éxito, además del body actual, setea la cookie. El body
  **mantiene** `refresh` durante la transición (el frontend viejo lo necesita);
  se marca con comentario `TODO(T08x-followup): drop refresh from body` y
  fecha.
- `auth/refresh/`: sustituir `TokenRefreshView` por una vista propia que:
  1. Toma el refresh de la cookie si existe; si no, del body (compatibilidad).
  2. Verifica `Origin`/`Referer` contra `CSRF_TRUSTED_ORIGINS` cuando la
     credencial vino por cookie (segunda capa anti-CSRF sobre
     `SameSite=Strict`); mismatch → 403.
  3. Rota (ROTATE_REFRESH_TOKENS ya activo) y responde: access en body,
     refresh nuevo en cookie. Si la petición vino por body (cliente viejo),
     responde también el refresh en body — es la pasarela de migración: el
     cliente nuevo que reciba cookie borrará su localStorage (T082).
- `logout` (T060): acepta el refresh de cookie o body, blacklistea y
  `clear_refresh_cookie`.

## Step 3 — Tests

1. `login_verify` OK → `Set-Cookie` con `HttpOnly`, `SameSite=Strict`,
   `Path=/api/auth/`.
2. Refresh solo-cookie → 200, access en body, cookie rotada, body sin
   `refresh`.
3. Refresh solo-body (cliente viejo) → 200 con refresh en body + cookie
   seteada (migración).
4. Refresh con cookie y `Origin` ajeno → 403.
5. Refresh con token blacklisteado (post-logout) → 401 y cookie limpiada.
6. Cookie no viaja fuera de `/api/auth/`: assert del atributo `path`.

## DoD — Definition of Done

1. Suite backend completa en verde.
2. Los 6 tests del paso 3 presentes.
3. Con el frontend ACTUAL (pre-T082) el login/refresh sigue funcionando — verificación manual en dev completa (compatibilidad demostrada).
4. `ruff check .` limpio.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Tests backend | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test apps.users 2>&1 \| tail -5` | `users_tests.txt` | "OK", 0 failures |
| 2 | Set-Cookie real | `curl -si -X POST http://localhost:18000/api/auth/login/verify/ -H 'Content-Type: application/json' -d '{…}' \| grep -i set-cookie` | `set_cookie.txt` | HttpOnly; SameSite=Strict; Path=/api/auth/ |
| 3 | Frontend viejo compatible | Recorrido manual login→uso→refresh en dev sin tocar frontend | `compat_manual.txt` | Sin errores en consola/red |

## Files to create/modify

| File | Action |
|------|--------|
| `backend/apps/users/auth_cookies.py` | CREATE |
| `backend/apps/users/views.py` | MODIFY (`login_verify`, `logout`, vista refresh propia) |
| `backend/apps/users/urls.py` | MODIFY (refresh apunta a la vista nueva) |
| `backend/apps/users/tests.py` (o paquete post-T073) | MODIFY |
