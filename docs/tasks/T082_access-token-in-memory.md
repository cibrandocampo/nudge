# T082 — Frontend: access token en memoria y refresh silencioso por cookie

## Context

Con T081 el backend habla cookie httpOnly. Este es el lado cliente del
hallazgo S1 fase 2: sacar ambos tokens de `localStorage` — el refresh deja de
ser visible para JS por completo; el access (2 h) vive solo en memoria. Plan:
`docs/plans/technical-review-remediation.md`, oleada J.

**Dependencies**: T081.

## Objective

`localStorage` no contiene ningún token; una sesión existente migra sola en su
primer refresh; el comportamiento offline de la PWA no se degrada.

## Step 1 — Access token en memoria

En `frontend/src/api/client.js`: variable de módulo `accessToken` con
`setAccessToken()`/`getAccessToken()` exportadas para AuthContext y tests.
Todos los `localStorage.getItem('access_token')` desaparecen. El header
`Authorization` se construye desde la variable.

## Step 2 — Refresh por cookie

`doRefresh()` deja de leer `refresh_token`: hace
`POST /auth/refresh/` con body vacío (la cookie viaja sola, mismo origen) y
guarda el access recibido en memoria. En 401 del refresh → sesión terminada →
limpiar y redirigir a login como hoy.

**Migración de sesiones existentes**: al arrancar, si `localStorage` contiene
un `refresh_token` legado, hacer un único refresh con él por body (el backend
responde con cookie, T081), guardar el access en memoria y **borrar ambos
tokens de localStorage**. A partir de ahí, solo cookie.

## Step 3 — Arranque y AuthContext

- `AuthProvider`: `hasToken` ya no puede leer localStorage. Nuevo arranque:
  intentar refresh silencioso (cookie o legado) ANTES de habilitar la query
  `['me']`; estado `bootstrapping` mientras tanto. Offline: el refresh falla
  con `OfflineError` → se procede con el snapshot persistido de TanStack Query
  (el comportamiento actual de "reabrir la PWA offline" se conserva —
  `user = query.data` rehidratado; las llamadas de red fallarían igual sin
  conexión).
- `loginVerify`: guarda el access en memoria; ignora el `refresh` del body si
  llega (transición); no escribe localStorage.
- `logout` (T060): sigue llamando al endpoint (que además limpia la cookie) y
  resetea la memoria.
- Cola offline (`offline/sync.js`): sin cambios de código esperados — usa
  `api.*`, que ahora renueva por cookie; el caso "replay tras reload con
  access caducado" queda cubierto por el refresh del 401 (`client.js:94-103`).
  Fijarlo con un test.

## Step 4 — Tests y limpieza

1. `client.js`: 401 → refresh por cookie → retry con access nuevo; sin
   escrituras a localStorage (spy).
2. Migración: localStorage con tokens legados → boot hace refresh por body,
   borra localStorage.
3. Boot offline con snapshot persistido → user visible, sin redirect a login.
4. `logout` limpia memoria y no deja rastro en localStorage.
5. Grep global: `localStorage.*token` → 0 apariciones en `src/` (fuera de la
   rutina de migración y sus tests).

## DoD — Definition of Done

1. `grep -rn "access_token\|refresh_token" frontend/src --include='*.js*' | grep -v __tests__ | grep -v migrate` → solo la rutina de migración.
2. Suite unit + coverage gates PASS.
3. E2E completos en `chromium-preview` en verde (login por UI cubre el flujo nuevo).
4. Manual en dev: login → DevTools Application → localStorage sin tokens; cookie `nudge_refresh` HttpOnly visible; recarga mantiene sesión; modo avión + reapertura muestra datos.
5. Lint/format limpios.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Sin tokens en LS | comando grep del DoD 1 | `no_ls_tokens.txt` | Solo migración |
| 2 | Unit + coverage | `… exec frontend npm run test:coverage 2>&1 \| tail -15` | `coverage.txt` | Gates PASS |
| 3 | E2E preview | `docker run … --project=chromium-preview 2>&1 \| tail -5` | `e2e_preview.txt` | 0 failed |
| 4 | Manual | Captura de DevTools (Application → Storage) tras login | `storage.png` | localStorage sin tokens; cookie HttpOnly presente |

## Files to create/modify

| File | Action |
|------|--------|
| `frontend/src/api/client.js` | MODIFY |
| `frontend/src/contexts/AuthContext.jsx` | MODIFY |
| `frontend/src/api/__tests__/client.test.js` | MODIFY |
| `frontend/src/contexts/__tests__/AuthContext.test.jsx` | MODIFY |
