# T059 — E2E: regresión de consumo con stock insuficiente

## Context

Cierre de la oleada B (`docs/plans/technical-review-remediation.md`): T057
endureció el contrato del API (422 en vez de éxito parcial silencioso) y T058
adaptó el frontend. Falta el test de integración que cruza las capas y fija el
comportamiento extremo a extremo, incluido el camino offline→sync que ningún
unit test cubre de verdad.

**Dependencies**: T058.

## Objective

Un spec Playwright nuevo demuestra que consumir más unidades de las
disponibles falla visiblemente, no altera el inventario, y que el mismo error
llegado vía cola offline es legible y descartable desde PendingBadge.

## Step 1 — Spec `stock-insufficient.spec.js`

Crear `e2e/tests/stock-insufficient.spec.js` siguiendo `test-discipline`
(un test = un concepto):

1. **Online**: seed → stock con 2 unidades → abrir consumo → forzar cantidad 5
   (si la UI capa el stepper a `quantity_available`, hacer la petición vía
   `page.request` autenticada para fijar el contrato del API: status 422 +
   `code=insufficient_stock`) → verificar toast/error y que el detalle sigue
   mostrando 2 ud.
2. **Offline→sync**: con la app cargada, `context.setOffline(true)` → consumir
   2 de 2 (queda encolado y optimista) → en paralelo, consumir las 2 unidades
   reales vía API (otro "dispositivo") → `setOffline(false)` → el drain recibe
   422 → PendingBadge muestra la entrada en error con mensaje traducido →
   descartar → el inventario vuelve a reflejar el estado del servidor (0 ud).

Usar los helpers existentes (`helpers/session.js`, `helpers/stocks.js`) y
esperas deterministas (`toPass`, sin `waitForTimeout` sueltos — ver
MEMORY.md sobre la flakiness por timeouts).

## Step 2 — Ejecutar en ambos proyectos

```bash
docker build -f e2e/Dockerfile -t nudge-e2e ./e2e
docker run --rm --network host \
  -v "$PWD/e2e/tests":/e2e/tests -v "$PWD/e2e/playwright.config.js":/e2e/playwright.config.js -v "$PWD/e2e/global-setup.js":/e2e/global-setup.js \
  -e E2E_USERNAME=admin -e E2E_PASSWORD=adminpass -e DEMO_USERS_PASSWORD=change-me \
  -e BASE_URL=http://localhost:15173 nudge-e2e npx playwright test stock-insufficient --project=chromium-dev
```

Repetir con `BASE_URL=http://localhost:14173` y `--project=chromium-preview`
(requiere `--profile preview up -d frontend-preview`).

## Step 3 — Estabilidad

Correr el spec 3 veces seguidas sin `--retries` (regla de `test-discipline`).
Si alguna pasada falla, diagnosticar la causa raíz (test/app/infra) antes de
tocar nada.

## DoD — Definition of Done

1. El spec nuevo pasa en `chromium-dev` y `chromium-preview`.
2. 3 ejecuciones consecutivas sin `--retries`, 3/3 en verde.
3. La suite E2E completa de `chromium-preview` sigue en verde (sin regresión de los 18 specs).
4. El spec no contiene `waitForTimeout` ni `test.skip`.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Spec en dev | `docker run … --project=chromium-dev 2>&1 \| tail -10` | `e2e_dev.txt` | passed, 0 failed |
| 2 | Spec en preview ×3 | `for i in 1 2 3; do docker run … --project=chromium-preview; done 2>&1 \| grep -E 'passed\|failed'` | `e2e_preview_x3.txt` | 3× passed |
| 3 | Suite preview completa | `docker run … npx playwright test --project=chromium-preview 2>&1 \| tail -5` | `e2e_full_preview.txt` | 0 failed |

## Files to create/modify

| File | Action |
|------|--------|
| `e2e/tests/stock-insufficient.spec.js` | CREATE |
| `e2e/tests/helpers/stocks.js` | MODIFY (solo si hace falta un helper de consumo) |
