# T058 — Frontend: manejo del 422 `insufficient_stock` en consumo directo y cola offline

## Context

Con T057, `POST /stock/{id}/consume/` puede devolver 422
`code=insufficient_stock` — hasta ahora solo lo hacía `log` de rutinas, y el
frontend ya tiene la pieza base: `utils/errors.js` mapea `insufficient_stock`
→ clave i18n `errors.insufficientStock`. Falta cablearlo en el flujo de
consumo directo y darle un tratamiento legible cuando el error llega en
diferido vía cola offline. Plan: `docs/plans/technical-review-remediation.md`,
oleada B.

**Dependencies**: T057.

## Objective

Un consumo rechazado por stock insuficiente revierte el update optimista y
muestra un mensaje claro con las unidades disponibles — tanto online
(respuesta inmediata) como offline (al sincronizar, desde PendingBadge).

## Step 1 — Camino online en `useConsumeStock`

`frontend/src/hooks/mutations/useConsumeStock.js`: hoy `onSuccess` maneja el
2xx; verificar cómo `useOfflineMutation` (`frontend/src/hooks/useOfflineMutation.js`)
propaga un 4xx online. El requisito:

- El update optimista se revierte (el `optimistic` ya devuelve un restore; el
  camino de error debe invocarlo — comprobar que `onError` lo hace, y si no,
  añadirlo).
- El componente que disparó el consumo (`LotConsumeModal` /
  `StockDetailPage`) muestra toast con `errorToastMessage` — que ya interpola
  `required`/`available` del body si el mapeo existe. Verificar la clave
  `errors.insufficientStock` en los 3 locales (`src/i18n/{en,es,gl}.json`) e
  interpolar `available` en el texto si aún no lo hace.

## Step 2 — Mismo tratamiento en `useLogRoutine`

`frontend/src/hooks/mutations/useLogRoutine.js` ya conoce el 422 del pre-check
(T036/RoutineCard). Revisar que el 422 **post-T057** (que ahora puede llegar
tras pasar el pre-check, por carrera) recorre el mismo camino de rollback +
toast. No debería requerir código nuevo; se fija con un test.

## Step 3 — Cola offline: etiqueta legible del error

En `frontend/src/offline/sync.js`, un 422 cae en `markError(id, "HTTP 422")`
(`sync.js:189`). Mejorar: cuando el body del error trae `code`, guardar
`errorMessage` como el código (`insufficient_stock`) en vez de `HTTP 422`,
y que `PendingBadge` lo traduzca vía `errors.js` al renderizar. Requiere leer
el body en `runEntry` para no-retryables (hoy no se lee).

El descarte desde PendingBadge ya aplica el rollback registrado
(`registerRollback('consumeStock')`) — sin cambios ahí; añadir test que lo
demuestre para este error concreto.

## Step 4 — Tests unitarios

1. `useConsumeStock` online: respuesta 422 con body `insufficient_stock` →
   cache de `['stock']` restaurada al snapshot previo + toast con la clave
   correcta.
2. `useLogRoutine`: ídem.
3. `sync.js`: entrada que recibe 422 con `code` queda `status=error` y
   `errorMessage=insufficient_stock`; no se reintenta.
4. `PendingBadge` renderiza el mensaje traducido para ese `errorMessage`.
5. Paridad i18n: las claves nuevas/modificadas existen en `en`, `es` y `gl`
   (los ficheros son planos con claves con puntos — ver MEMORY.md).

## DoD — Definition of Done

1. `docker compose --env-file .env -f dev/docker-compose.yml exec frontend npx vitest run` en verde.
2. `docker compose --env-file .env -f dev/docker-compose.yml exec frontend npm run test:coverage` pasa los gates (95/95/95/93).
3. Paridad de claves i18n verificada: mismo `len(set(...))` en los 3 JSON.
4. `npm run lint -- --max-warnings 0` y `npm run format:check` limpios.
5. Verificación manual en dev (`http://localhost:15173`): crear stock con 2 unidades, intentar consumir 5 → toast "insuficiente… quedan 2", inventario intacto.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Unit tests | `docker compose --env-file .env -f dev/docker-compose.yml exec frontend npx vitest run 2>&1 \| tail -10` | `vitest.txt` | 0 failed |
| 2 | Cobertura | `docker compose --env-file .env -f dev/docker-compose.yml exec frontend npm run test:coverage 2>&1 \| tail -15` | `coverage.txt` | Todos los gates PASS |
| 3 | Paridad i18n | `docker compose --env-file .env -f dev/docker-compose.yml exec frontend node -e "const l=['en','es','gl'].map(x=>Object.keys(require('/app/src/i18n/'+x+'.json')).length);console.log(l)"` | `i18n_parity.txt` | Los 3 números iguales |
| 4 | Manual dev | Captura del toast con stock insuficiente | `manual_toast.png` | Mensaje traducido con unidades disponibles |

## Files to create/modify

| File | Action |
|------|--------|
| `frontend/src/hooks/mutations/useConsumeStock.js` | MODIFY |
| `frontend/src/hooks/mutations/useLogRoutine.js` | MODIFY (solo si el test revela hueco) |
| `frontend/src/offline/sync.js` | MODIFY (errorMessage con `code` del body) |
| `frontend/src/components/PendingBadge.jsx` | MODIFY (traducción del código) |
| `frontend/src/utils/errors.js` | MODIFY (interpolación `available` si falta) |
| `frontend/src/i18n/en.json`, `es.json`, `gl.json` | MODIFY |
| Tests de los anteriores en `__tests__/` | MODIFY/CREATE |
