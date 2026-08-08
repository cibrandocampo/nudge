# T076 — `useRoutineForm` y secciones para `RoutineFormPage`

## Context

Hallazgo Q1 (`docs/technical-review.md`): `RoutineFormPage.jsx` (637 líneas)
mezcla el estado del formulario (intervalos, fases, recordatorios, stock,
sharing, backdating) con la orquestación de crear/editar y la presentación.
~15 ramas sin cubrir. Plan: `docs/plans/technical-review-remediation.md`,
oleada H.

**Dependencies**: None.

## Objective

El estado y la validación del formulario viven en un hook `useRoutineForm`;
la página compone secciones de presentación. Cero estado de formulario en el
componente de página.

## Step 1 — Hook `useRoutineForm`

`frontend/src/hooks/useRoutineForm.js`: posee el estado completo del
formulario (valores, dirty, errores de validación client-side), la
inicialización desde una rutina existente (modo edición) y el `toPayload()`
que produce el body del POST/PATCH (incluidos `interval_phases` y
`backdated_first_entry_at`). Sin JSX. Las mutaciones
(`useCreateRoutine`/`useUpdateRoutine`) las sigue invocando la página con el
payload del hook.

## Step 2 — Secciones de presentación

`frontend/src/components/routine-form/`: `BasicsSection` (nombre,
descripción), `ScheduleSection` (IntervalPicker + fases), `RemindersSection`
(modo, intervalo, quiet hours), `StockSection` (stock vinculado + usage),
`SharingSection` (reutilizando `ShareWithSection` existente). Reciben slices
del hook (`value`/`onChange` por campo o el objeto form completo — seguir el
patrón que dejó el refactor de StockForm si T053 estableció uno).

## Step 3 — Tests

- Tests del hook en aislamiento (`renderHook`): inicialización edición,
  validaciones, `toPayload` con y sin fases, backdating no-futuro.
- Tests de secciones con el hook real (no mocks del estado).
- Migrar los asserts existentes de `RoutineFormPage.test.jsx`; cubrir las
  ramas descubiertas que sean alcanzables.
- E2E `routines.spec.js` sin cambios.

## DoD — Definition of Done

1. `grep -c "useState" frontend/src/pages/RoutineFormPage.jsx` ≤ 2.
2. Suite unit + coverage gates PASS.
3. E2E `routines.spec.js` y `routine-completion.spec.js` en verde (`chromium-dev`).
4. Guard CSS modules en verde; lint/format limpios.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Página delgada | `wc -l frontend/src/pages/RoutineFormPage.jsx frontend/src/hooks/useRoutineForm.js frontend/src/components/routine-form/*.jsx` | `sizes.txt` | Estado en el hook, página compone |
| 2 | Cobertura | `… exec frontend npm run test:coverage 2>&1 \| tail -15` | `coverage.txt` | Gates PASS |
| 3 | E2E rutinas | `docker run … npx playwright test routines routine-completion --project=chromium-dev 2>&1 \| tail -5` | `e2e_routines.txt` | 0 failed |

## Files to create/modify

| File | Action |
|------|--------|
| `frontend/src/hooks/useRoutineForm.js` | CREATE |
| `frontend/src/components/routine-form/*.jsx` | CREATE |
| `frontend/src/pages/RoutineFormPage.jsx` | MODIFY |
| `frontend/src/pages/__tests__/RoutineFormPage.test.jsx` | MODIFY (reparto) |
| `frontend/src/hooks/__tests__/useRoutineForm.test.js` | CREATE |
