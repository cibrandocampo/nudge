# T064 — Sync worker: tratar 409 como reintentable (cliente tolerante primero)

## Context

Preparación de la oleada D (`docs/plans/technical-review-remediation.md`,
hallazgo C2): T065 hará que el middleware de idempotencia responda **409 +
Retry-After** al perdedor de una carrera. Hoy `offline/sync.js` clasifica 409
como "otro 4xx" → entrada a estado `error` no reintentable. Este cambio de
cliente debe desplegarse **antes** que el de servidor: un cliente viejo contra
el backend nuevo convertiría carreras benignas en errores manuales.

**Dependencies**: None (pero T065 depende de esta).

## Objective

Una respuesta 409 a una mutación de la cola offline se reintenta con el
backoff existente, exactamente como 408/429/5xx.

## Step 1 — Añadir 409 a los estados reintentables

En `frontend/src/offline/sync.js:28`:

```js
const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504])
```

Revisar también el camino **online** (`useOfflineMutation`): un 409 online
debe reintentarse de forma transparente o encolarse — decidir según el
comportamiento actual del hook con 429 (mantener simetría con ese caso, que
es el precedente más cercano).

## Step 2 — Tests

En `frontend/src/offline/__tests__/` (siguiendo los tests existentes del
worker):

1. Entrada cuyo fetch devuelve 409 → `markRetryPending` con el delay del
   `retryCount` actual; tras agotar `MAX_RETRIES` → `error` (mismo contrato
   que 429).
2. La misma `Idempotency-Key` se reenvía en el reintento (ya garantizado por
   `runEntry` — fijarlo con un assert explícito, es la propiedad que hace
   seguro el diseño de T065).

## DoD — Definition of Done

1. `docker compose --env-file .env -f dev/docker-compose.yml exec frontend npx vitest run` en verde.
2. Test explícito: 409 → retry con misma Idempotency-Key.
3. Gates de cobertura frontend intactos (`npm run test:coverage`).
4. `npm run lint -- --max-warnings 0` limpio.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Tests worker | `docker compose --env-file .env -f dev/docker-compose.yml exec frontend npx vitest run src/offline 2>&1 \| tail -10` | `sync_tests.txt` | 0 failed |
| 2 | Cobertura | `docker compose --env-file .env -f dev/docker-compose.yml exec frontend npm run test:coverage 2>&1 \| tail -15` | `coverage.txt` | Gates PASS |

## Files to create/modify

| File | Action |
|------|--------|
| `frontend/src/offline/sync.js` | MODIFY |
| `frontend/src/hooks/useOfflineMutation.js` | MODIFY (solo si el 409 online lo requiere) |
| `frontend/src/offline/__tests__/sync.test.js` | MODIFY |
