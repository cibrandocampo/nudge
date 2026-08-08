# T083 — E2E de la migración de auth: PWA, offline y specs de sesión

## Context

Cierre verificador de la oleada J (`docs/plans/technical-review-remediation.md`):
T081/T082 cambiaron el mecanismo de sesión. Los unit tests cubren las piezas;
falta demostrar extremo a extremo que la PWA instalable, el flujo offline y
los specs de sesión existentes sobreviven, con la red de T078 (E2E en CI) ya
activa.

**Dependencies**: T082, T078.

## Objective

Suite E2E completa en verde con el auth nuevo; specs nuevos fijan la migración
de sesiones legadas y las propiedades de la cookie; cualquier spec que
manipulaba tokens en localStorage queda actualizado.

## Step 1 — Barrido de specs afectados

```bash
grep -rn "localStorage" e2e/tests/ | grep -iE "token|access|refresh"
```

Actualizar cada hit al mecanismo nuevo (login por UI con
`helpers/session.js loginAs` ya es el camino estándar; los atajos por
localStorage se sustituyen por login real o por seteo del access en memoria
vía la API que exponga T082 para tests).

## Step 2 — Specs nuevos (`auth-cookie.spec.js`)

1. **Cookie correcta**: tras login, `context.cookies()` contiene
   `nudge_refresh` con `httpOnly: true`, `sameSite: 'Strict'`,
   `path: '/api/auth/'`; `localStorage` sin tokens.
2. **Migración legada**: sembrar localStorage con un par de tokens válidos
   (obtenidos vía API), recargar → la app queda logueada, localStorage limpio,
   cookie presente.
3. **Revocación**: logout → `POST /api/auth/refresh/` manual (page.request,
   incluyendo la cookie) → 401.
4. **Offline**: sesión activa → `context.setOffline(true)` → recargar → la
   app muestra los datos del snapshot sin redirect a login (regresión del
   comportamiento PWA actual).

## Step 3 — Suites completas

- `chromium-preview` completo + `chromium-dev` completo (spec a spec con
  `--timeout` si hace falta, según MEMORY.md), 3 pasadas del spec nuevo sin
  `--retries`.
- Verificar que el job de CI (T078) pasa con todo esto en la rama.

## DoD — Definition of Done

1. `grep -rn "localStorage" e2e/tests/ | grep -i token` → solo el spec de migración legada.
2. `auth-cookie.spec.js` con los 4 escenarios, 3/3 pasadas limpias.
3. Suite `chromium-preview` completa en verde; `chromium-dev` sin regresiones nuevas (los flakes preexistentes documentados no cuentan, pero nada nuevo).
4. Job de CI en verde en el PR.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Spec nuevo ×3 | `for i in 1 2 3; do docker run … npx playwright test auth-cookie --project=chromium-preview; done 2>&1 \| grep -E 'passed\|failed'` | `auth_cookie_x3.txt` | 3× passed |
| 2 | Preview completo | `docker run … --project=chromium-preview 2>&1 \| tail -5` | `e2e_preview.txt` | 0 failed |
| 3 | CI | `gh pr checks <pr> 2>&1` | `ci_checks.txt` | test-e2e ✓ |

## Files to create/modify

| File | Action |
|------|--------|
| `e2e/tests/auth-cookie.spec.js` | CREATE |
| `e2e/tests/helpers/session.js` | MODIFY (si algún atajo usaba localStorage) |
| Specs con atajos de token | MODIFY (según barrido) |
