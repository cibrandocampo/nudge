# T080 — Auditoría de dependencias en CI y Dependabot

## Context

Hallazgo S6 de `docs/technical-review.md` (segunda mitad): no hay escaneo de
vulnerabilidades (`pip-audit`, `npm audit`) ni actualización automatizada de
dependencias (`dependabot.yml`); `weekly-rebuild.yml` solo refresca imágenes.
Plan: `docs/plans/technical-review-remediation.md`, oleada I. Depende de T079:
`pip-audit` audita el lock, no rangos.

**Dependencies**: T079.

## Objective

Cada PR informa de vulnerabilidades conocidas en las dependencias de runtime,
y Dependabot propone bumps agrupados mensualmente sin inundar de PRs.

## Step 1 — Job `audit` en CI

Nuevo job en `ci.yml` (no bloqueante al principio — `continue-on-error: true`
con anotación visible; pasar a gate cuando lleve dos semanas limpio, como
marca el plan):

```yaml
- run: pip install pip-audit && pip-audit -r backend/requirements.lock --require-hashes
- run: cd frontend && npm ci && npm audit --omit=dev --audit-level=high
```

`npm audit --omit=dev` está a 0 hoy (MEMORY.md) — debería nacer en verde.
Para `pip-audit`, si aparece un falso positivo/unfixable, usar `--ignore-vuln`
con comentario justificando, nunca desactivar el job.

## Step 2 — `dependabot.yml`

`.github/dependabot.yml` con tres ecosistemas, agrupación mensual:

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule: {interval: monthly}
  - package-ecosystem: npm
    directory: /frontend
    schedule: {interval: monthly}
    groups: {minor-and-patch: {update-types: [minor, patch]}}
  - package-ecosystem: pip
    directory: /backend
    schedule: {interval: monthly}
    groups: {minor-and-patch: {update-types: [minor, patch]}}
```

Nota: dependabot para pip lee `requirements.in`; el PR de bump requiere
regenerar el lock a mano (documentado en el flujo de T079). Los majors llegan
como PRs individuales — se triagean con el proceso de `dependency-upgrades.md`
(serie T013-T019).

También cubrir `/site` (npm) y `/e2e` (npm) si dependabot no los detecta por
la agrupación de directorios — un bloque por directorio.

## Step 3 — Verificación

- El job `audit` corre en el PR de esta tarea.
- `gh api /repos/<owner>/nudge/dependabot/alerts` accesible o la pestaña
  Dependabot activa (según plan del repo).

## DoD — Definition of Done

1. Job `audit` visible y ejecutado en el PR (verde o con hallazgos anotados).
2. `dependabot.yml` validado (GitHub lo parsea sin error — pestaña Insights → Dependency graph → Dependabot).
3. `npm audit --omit=dev` a 0 en el run.
4. Decisión "informativo → gate" anotada como comentario en el propio job con la fecha de revisión.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Run del job | `gh run view <run-id> --log 2>&1 \| grep -A5 -i audit \| tail -20` | `audit_run.txt` | Ejecutado; npm audit 0 vulnerabilidades runtime |
| 2 | Dependabot activo | Captura de la pestaña Dependabot o `gh api repos/{owner}/{repo}/contents/.github/dependabot.yml --jq .name` | `dependabot.txt` | Config presente y aceptada |

## Files to create/modify

| File | Action |
|------|--------|
| `.github/workflows/ci.yml` | MODIFY (job audit) |
| `.github/dependabot.yml` | CREATE |
