# T077 — Mismo patrón en `RoutineDetailPage` y `StockFormPage`

## Context

Cierre del hallazgo Q1 (`docs/technical-review.md`): `RoutineDetailPage.jsx`
(547 líneas) y `StockFormPage.jsx` (458) son los dos siguientes en la lista de
páginas-dios, con menor prioridad que Settings y RoutineForm. Se ejecuta
después de T076 para reutilizar el patrón que esa tarea asiente (hook de
formulario + secciones). Plan: `docs/plans/technical-review-remediation.md`,
oleada H.

**Dependencies**: T076.

## Objective

Ambas páginas quedan como composición; el estado de formulario/orquestación
baja a hooks y secciones, con el mismo criterio estructural de T075/T076.

## Step 1 — `RoutineDetailPage`

Extraer: cabecera con acciones (log/editar/compartir), bloque de historial
(lista de entries + paginación), bloque de stock vinculado, y el flujo
`?action=mark-done` de los push (query param → modal). Los candidatos
naturales: `RoutineDetailHeader`, `RoutineEntryHistory`,
`RoutineStockPanel`. El deep-link handling se queda en la página.

## Step 2 — `StockFormPage`

Extraer un `useStockForm` (misma forma que `useRoutineForm` de T076) y
secciones (`IdentitySection` con GTIN/nombre/grupo, `LotDefaultsSection`,
`SharingSection` reutilizada). Respetar el flujo de escaneo → prefill (T028+)
sin cambiarle la semántica.

## Step 3 — Tests y verificación

- Reparto de los tests existentes por sección/hook; ramas descubiertas
  alcanzables cubiertas.
- E2E afectados en verde: `routines.spec.js`, `routine-completion.spec.js`,
  `inventory.spec.js`, `stockform-buttons-visual.spec.js`,
  `stock-expiry.spec.js`.
- Manual: escaneo de un lote desde StockForm sigue prefilleando.

## DoD — Definition of Done

1. `grep -c "useState" frontend/src/pages/RoutineDetailPage.jsx` ≤ 3 y `…/StockFormPage.jsx` ≤ 2 (estado de formulario en hooks).
2. Suite unit + coverage gates PASS.
3. Los 5 specs E2E listados en verde (`chromium-dev`).
4. Guard CSS modules en verde; lint/format limpios.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Tamaños | `wc -l frontend/src/pages/RoutineDetailPage.jsx frontend/src/pages/StockFormPage.jsx frontend/src/components/routine-detail/*.jsx frontend/src/components/stock-form/*.jsx 2>/dev/null` | `sizes.txt` | Páginas = composición |
| 2 | Cobertura | `… exec frontend npm run test:coverage 2>&1 \| tail -15` | `coverage.txt` | Gates PASS |
| 3 | E2E | `docker run … npx playwright test routines routine-completion inventory stockform-buttons-visual stock-expiry --project=chromium-dev 2>&1 \| tail -5` | `e2e.txt` | 0 failed |

## Files to create/modify

| File | Action |
|------|--------|
| `frontend/src/pages/RoutineDetailPage.jsx` | MODIFY |
| `frontend/src/pages/StockFormPage.jsx` | MODIFY |
| `frontend/src/components/routine-detail/*.jsx` | CREATE |
| `frontend/src/components/stock-form/*.jsx` | CREATE |
| `frontend/src/hooks/useStockForm.js` | CREATE |
| Tests correspondientes | MODIFY/CREATE |
