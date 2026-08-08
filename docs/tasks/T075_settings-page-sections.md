# T075 — Descomponer `SettingsPage` en secciones autocontenidas

## Context

Hallazgo Q1 de `docs/technical-review.md`: `SettingsPage.jsx` (663 líneas)
concentra perfil, idioma, push, horas de silencio y contactos — estado de
formulario + orquestación + presentación en un componente. El gap de cobertura
de ramas del proyecto se concentra ahí (~16 ramas). El patrón a seguir es el
del refactor de StockDetail (#75, plan `stock-frontend-refactor.md`, tareas
T037-T045). Plan: `docs/plans/technical-review-remediation.md`, oleada H.

**Dependencies**: None.

## Objective

`SettingsPage` queda como composición de secciones; cada sección posee su
estado y sus mutaciones y es testeable de forma aislada. Criterio estructural
(no de líneas): **cero estado de formulario en el componente de página**.

## Step 1 — Extraer secciones

Nuevos componentes en `frontend/src/components/settings/`:

| Componente | Se lleva de la página |
|------------|----------------------|
| `ProfileSection` | nombre/apellidos, cambio de contraseña (modal trigger) |
| `LanguageSection` | selector de idioma + sync con i18n |
| `NotificationsSection` | push subscribe/unsubscribe, hora del heads-up, flash por hash `#push` |
| `QuietHoursSection` | toggle + rangos + aviso de solapamiento (`isInQuietHours`) |
| `ContactsSection` | alta por email, listado, borrado con ConfirmModal |

Reglas:
- Cada sección usa sus propios hooks (`useUpdateMe`, `useContacts`, etc.) —
  la página no pasa callbacks de negocio, como mucho props de presentación.
- El debounce de guardado de horas (`timeSaveTimer`) vive en la sección que
  lo usa (o en un hook `useDebouncedPatch` si dos secciones lo repiten).
- El scroll-to-hash + flash se queda en la página (es orquestación de página
  legítima) pero el id de destino lo declara cada sección.
- CSS: cada sección con su `.module.css` o reutilizando
  `styles/{forms,cards,buttons}.module.css`. El guard de T044
  (`cssModuleReferences.test.js`) vigilará las referencias — no moverse
  clases sin verificarlo.

## Step 2 — Tests por sección

Migrar los tests actuales de `SettingsPage.test.jsx` a un fichero por sección
(mover asserts, no reescribirlos) + tests nuevos para las ramas hoy
descubiertas (la lista exacta sale de `coverage-final.json`, ver MEMORY.md
sobre cómo leer `d.b[id]`/`branchMap`). Antes de escribir un test por rama,
comprobar que la rama es alcanzable (3 ramas muertas encontradas en pasadas
anteriores — borrarlas es el fix correcto).

## Step 3 — Verificación

- Suite unit + coverage.
- E2E `settings.spec.js` sin cambios (la UI no cambia visualmente).
- Manual en dev: recorrer las 5 secciones, incluido el deep-link `#push`.

## DoD — Definition of Done

1. `SettingsPage.jsx` sin `useState` de datos de formulario: `grep -c "useState" frontend/src/pages/SettingsPage.jsx` ≤ 2 (solo orquestación de página: flash/modal si acaso).
2. `docker compose --env-file .env -f dev/docker-compose.yml exec frontend npm run test:coverage` con gates PASS y ramas de `SettingsPage`/secciones ≥ 93 % local.
3. `settings.spec.js` E2E en verde en `chromium-dev`.
4. Guard de CSS modules en verde (incluido en la suite unit).
5. `npm run lint -- --max-warnings 0` y `npm run format:check` limpios.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Página delgada | `wc -l frontend/src/pages/SettingsPage.jsx frontend/src/components/settings/*.jsx` | `sizes.txt` | Página = composición; secciones autocontenidas |
| 2 | Cobertura | `… exec frontend npm run test:coverage 2>&1 \| tail -15` | `coverage.txt` | Gates PASS |
| 3 | E2E settings | `docker run … nudge-e2e npx playwright test settings --project=chromium-dev 2>&1 \| tail -5` | `e2e_settings.txt` | 0 failed |

## Files to create/modify

| File | Action |
|------|--------|
| `frontend/src/pages/SettingsPage.jsx` | MODIFY (queda composición) |
| `frontend/src/components/settings/*.jsx` + `.module.css` | CREATE (5 secciones) |
| `frontend/src/pages/__tests__/SettingsPage.test.jsx` | MODIFY (reparto) |
| `frontend/src/components/__tests__/settings/*.test.jsx` | CREATE |
