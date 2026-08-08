# Task index — Nudge

## Series T001–T002 — App version display in Settings

Plan: [docs/plans/app-version-display.md](../plans/app-version-display.md)

| ID | Title | Dependencies | Status | QA |
|----|-------|-------------|--------|----|
| T001 | Frontend: mostrar versión en Settings | — | Completed | — |
| T002 | Infra: inyectar versión en build de CI | — | Completed | — |

### Execution order

```
T001 ──┐
       ├──→ (PR)
T002 ──┘
```

---

## Series T003–T006 — Per-user stock group assignment

Plan: [docs/plans/per-user-stock-group.md](../plans/per-user-stock-group.md)

| ID | Title | Dependencies | Status | QA |
|----|-------|-------------|--------|----|
| T003 | Fix: show other recipients alongside owner in StockDetailPage | — | Completed | Approved |
| T004 | Backend: `UserStockGroup` model, migration and signal extension | — | Completed | Approved |
| T005 | Backend: effective group in serializer and `my-group` action | T004 | Completed | — |
| T006 | Frontend: `useSetMyStockGroup` hook and group picker in StockDetailPage | T005 | Completed | — |

### Execution order

```
T003 (independent fix)

T004 ──→ T005 ──→ T006
```

---

## Series T007 — Effective date display for history entries

Plan: [docs/plans/effective-date-display.md](../plans/effective-date-display.md)

| ID | Title | Dependencies | Status | QA |
|----|-------|-------------|--------|----|
| T007 | Frontend: effective date display for history entries | — | Completed | — |

### Execution order

```
T007 (standalone)
```

---

## Series T008–T012 — Dynamic interval phases

Plan: [docs/plans/dynamic-interval-phases.md](../plans/dynamic-interval-phases.md)

| ID | Title | Dependencies | Status | QA |
|----|-------|-------------|--------|----|
| T008 | Backend: model `interval_phases` + migración + `next_due_at()` | — | Completed | — |
| T009 | Backend: serializer — exponer y validar `interval_phases` | T008 | Completed | — |
| T010 | Backend: tests de lógica de fases (model + serializer) | T008, T009 | Completed | — |
| T011 | Frontend: editor de fases en `RoutineFormPage` + i18n | T009 | Completed | — |
| T012 | Frontend: tests de `RoutineFormPage` con fases | T011 | Completed | — |

### Execution order

```
T008 ──→ T009 ──→ T010 (backend tests)
              └──→ T011 (frontend form + i18n) ──→ T012 (frontend tests)
```

---

## Series T013–T019 — Dependency upgrades (keep LTS)

Plan: [docs/plans/dependency-upgrades.md](../plans/dependency-upgrades.md)

| ID | Title | Dependencies | Status | QA |
|----|-------|-------------|--------|----|
| T013 | Backend: bump non-Django deps (gunicorn 23→26, redis-py 5→6, …), keep Django 5.2 LTS | — | Completed | Approved |
| T014 | Frontend: non-breaking minor bumps (tanstack, msw, testing-library, lucide, …) | — | Completed | Approved |
| T015 | Frontend toolchain majors: Node 24, Vite 8, Vitest 4, vite-plugin-pwa 1.x, ESLint 10 | T014 | Completed | Approved |
| T016 | Frontend runtime majors: React 19, react-router 7, i18next 26, drop `uuid` | T015 | Completed | Approved |
| T017 | E2E: Playwright 1.58→1.61 (package + base image) | — | Completed | Approved |
| T018 | Site: Astro 4→7, Tailwind 3→4 (`@tailwindcss/vite`), TypeScript 6 | — | Completed | Approved |
| T019 | Infra sweep + end-to-end verification (compose pins, full-stack boot, all suites) | T013, T016, T017, T018 | Completed | Approved |

### Execution order

```
T013 (backend) ─────────────────────────────────┐
                                                 │
T014 ──→ T015 ──→ T016 (frontend chain) ─────────┤
                                                 │
T017 (e2e/playwright) ───────────────────────────┤
                                                 │
T018 (site) ─────────────────────────────────────┤
                                                 ▼
                                        T019 (infra sweep + verify)
```

---

## Series T020–T021 — Backdate routine completion

Plan: [docs/plans/backdate-routine-completion.md](../plans/backdate-routine-completion.md)

| ID | Title | Dependencies | Status | QA |
|----|-------|-------------|--------|----|
| T020 | Frontend: back-date primitives — `clientCreatedAt` in `useLogRoutine` + `LogDateModal` + i18n + unit tests | — | Completed | Approved |
| T021 | Frontend: integration in `RoutineDetailPage` — split both action buttons + 🕐 button, wire modal, lot-selection carry-through, tests | T020 | Completed | Approved |

### Execution order

```
T020 ──→ T021
```

---

## Series T022–T028 — Scan a GS1 DataMatrix to create a stock lot

Plan: [docs/plans/scan-lot-from-datamatrix.md](../plans/scan-lot-from-datamatrix.md)

| ID | Title | Dependencies | Status | QA |
|----|-------|-------------|--------|----|
| T022 | Backend: `serial_number` + `raw_scan` on `StockLot`, partial unique constraint, no-merge guard on create | — | Completed | — |
| T023 | Backend: serial in the `consumed_lots` snapshot + no-merge undo restore | T022 | Completed | — |
| T024 | Frontend: GS1 parser `utils/gs1.js` (AIs, GS separator, date rules, check digit, Digital Link) | — | Completed | — |
| T025 | Frontend: lot grouping + two-step (lot → pack) selection in both modals + serial in history | T022 | Completed | — |
| T026 | Frontend: `BarcodeScannerModal` (zxing-wasm), SW runtime cache, `useScannerAvailable` | — | Completed | — |
| T027 | Frontend: grouped, expandable lot list in `StockDetailPage` | T022, T025 | Completed | — |
| T028 | Frontend: scan → prefill the add-lot form (guards: expired, duplicate serial) | T024, T026, T027 | Completed | — |

### Execution order

```
T022 ──┬──→ T023  (backend: consumption + undo)
       │
       └──→ T025 ──→ T027 ──┐
                            │
T024 (parser) ──────────────┼──→ T028  (integration)
                            │
T026 (scanner + SW) ────────┘
```

---

## Series T029–T033 — GTIN and default lot quantity on Stock

Plan: [docs/plans/gtin-and-default-lot-quantity.md](../plans/gtin-and-default-lot-quantity.md)

| ID | Title | Dependencies | Status | QA |
|----|-------|-------------|--------|----|
| T029 | Backend: `gtin` + `default_lot_quantity` on `Stock`, writable + validated, admin, tests | — | Completed | — |
| T030 | Frontend: pure reconciliation helper `utils/stockScanReconcile.js` | — | Completed | — |
| T031 | Frontend: confirmation modal for product-value changes (current vs new per field) | T030 | Completed | — |
| T032 | Frontend: both fields in `StockFormPage`, batch prefill, assign-on-create (no prompt) | T029 | Completed | — |
| T033 | Frontend: add-lot prefill, unconditional `raw_scan`, reconciliation + modal on submit | T029, T030, T031, T032 | Completed | — |

### Execution order

```
T029 (backend) ──┬──────────────→ T032 ──┐
                 │                       │
                 └───────────────────────┼──→ T033
                                         │
T030 (helper) ───────→ T031 ─────────────┘
```

---

## Series T034–T036 — History card: readable lot/serial, and a notes editor that behaves

Plan: [docs/plans/history-card-legibility-and-notes-editor.md](../plans/history-card-legibility-and-notes-editor.md)

| ID | Title | Dependencies | Status | QA |
|----|-------|-------------|--------|----|
| T034 | Lot and serial told apart: `LOT · SN` inline in compact, labelled lines in extended | — | Completed | — |
| T035 | Note at rest: plain text, no hidden touch target, pencil beside the comment | — | Completed | — |
| T036 | Note while editing: save button, discard confirmation on Escape and click-outside | T035 | Completed | — |

### Execution order

```
T034 (lot/serial) ──────────────── independent

T035 (note at rest) ──→ T036 (note while editing)
```

---

## Series T037–T046 — Stock frontend refactor

Plan: [docs/plans/stock-frontend-refactor.md](../plans/stock-frontend-refactor.md)

Prepares the ground for [manual-serial-and-faster-lot-entry.md](../plans/manual-serial-and-faster-lot-entry.md).
**Series complete (2026-08-08).** That plan was re-based against the new
structure by T046 and is ready for `/dev-2-tasks`.

| ID | Title | Dependencies | Status | QA |
|----|-------|-------------|--------|----|
| T037 | `StockLotsList` out of `StockDetailPage` | — | Completed | — |
| T038 | `AddLotForm` out of `StockDetailPage`, promise-based submit contract | T037 | Completed | — |
| T039 | `LotRow` shared by `StockCard` and `StockLotsList`, one grid contract | T037 | Completed | — |
| T040 | `Combobox` free-text mode, adopted by the lot-number field | T038 | Completed | — |
| T041 | One lot consumption flow (`LotConsumeModal`), one skip rule | — | Completed | — |
| T042 | Serial visible when a group holds a single identified pack | T041 | Completed | — |
| T043 | `StockAlertCard` for the four inventory alerts | — | Completed | — |
| T044 | Guard test for CSS-module class references | — | Completed | — |
| T045 | Split `shared.module.css` by role, no class renamed | T039, T040, T042, T043, T044 | Completed | — |
| T046 | Re-base the feature plan against the new structure | T045 | Completed | — |

### Execution order

```
T037 ──┬──→ T038 ──→ T040 ──────────┐
       │                            │
       └──→ T039 ───────────────────┤
                                    │
T041 ──→ T042 ──────────────────────┼──→ T045 ──→ T046
                                    │
T043 ───────────────────────────────┤
                                    │
T044 ───────────────────────────────┘
```

---

## Series T047–T053 — Manual serial entry and faster lot entry

Plan: [docs/plans/manual-serial-and-faster-lot-entry.md](../plans/manual-serial-and-faster-lot-entry.md)

Re-based against the post-refactor tree by T046. i18n and tests are **not**
separate tasks: each task carries its own keys in all three locales and its own
DoD, so no task lands untranslated or unverifiable.

| ID | Title | Dependencies | Status | QA |
|----|-------|-------------|--------|----|
| T047 | Helper `lotSuggestions`: suggestions carry their expiry, expired ones dropped | — | Completed | — |
| T048 | The serial becomes a form field, not a scan artefact | — | Completed | — |
| T049 | Quantity and expiry always; lot and serial behind `+ campos` | T048 | Completed | — |
| T050 | Picking a suggested lot inherits its expiry and locks the field | T047 | Completed | — |
| T051 | "Guardar y añadir otro" | T049 | Completed | — |
| T052 | The last identified box can still be read (expander when serialized) | — | Completed | — |
| T053 | The same fields when creating a product | T048, T049 | Completed | — |

### Execution order

```
T047 ────────────────→ T050

T048 ──→ T049 ──┬────→ T051
   └────────────┴────→ T053

T052  (independent — resolves the case that motivated the feature)
```

**Series complete (2026-08-09).**

### Notes

- **T052 has no dependencies and is the smallest.** It fixes the problem the user
  stated literally ("if I need to look up the serial of a product it would be
  impossible if it is the last one"), observed on a real box during T028's
  manual verification. Worth pulling forward if early value matters.
- **T048 and T049 together** are what puts a typeable serial and the `+ campos`
  control on screen.
- `lockedInput` / `lockBadge` move to `styles/forms.module.css` inside **T050**,
  its only new consumer, rather than as a task of their own. The T044 guard is
  the check that the move stranded nothing.

---

## Series T054–T084 — Remediación de la revisión técnica

Plan: [docs/plans/technical-review-remediation.md](../plans/technical-review-remediation.md)
Hallazgos: [docs/technical-review.md](../technical-review.md)

Diez oleadas (A–J). Cada oleada deja `main` desplegable. **Advertencia de
caducidad**: las tareas de las oleadas E–J (T066+) se escribieron contra el
árbol de 2026-08-09; las oleadas B–D modifican ese código. Antes de ejecutar
cualquier tarea ≥ T066, releerla contra el árbol real y re-basarla si los
anclajes ya no existen (precedente: T046).

| ID | Title | Dependencies | Status | QA |
|----|-------|-------------|--------|----|
| T054 | Higiene de repo: .gitignore para .pem/celerybeat, borrado de residuos | — | Pending | — |
| T055 | Cabeceras de seguridad + CSP en nginx | — | Pending | — |
| T056 | Excepciones de dominio + exception handler DRF | — | Pending | — |
| T057 | Invariante consumido==solicitado + ConsumeInputSerializer | T056 | Pending | — |
| T058 | Frontend: manejo del 422 insufficient_stock | T057 | Pending | — |
| T059 | E2E: regresión de consumo con stock insuficiente | T058 | Pending | — |
| T060 | Logout con revocación del refresh token | — | Pending | — |
| T061 | Doble candado del endpoint de seed | — | Pending | — |
| T062 | Fuerza bruta: throttle change_password + lockout por cuenta | — | Pending | — |
| T063 | Matriz de permisos y privacidad: doc + tests que la congelan | — | Pending | — |
| T064 | Sync worker: 409 reintentable (cliente tolerante primero) | — | Pending | — |
| T065 | Idempotencia reserva-primero | T064 | Pending | — |
| T066 | services.py en routines: log_routine, consume_stock, undo_entry | T057 | Pending | — |
| T067 | check_precondition compartida (mixin + me) | — | Pending | — |
| T068 | routines_for_user: queryset compartido viewset/dashboard | — | Pending | — |
| T069 | stock_metrics.py: partición y severidades | T066 | Pending | — |
| T070 | stock_metrics.py: tasas de consumo y agotamiento | T069 | Pending | — |
| T071 | Push de sharing/contactos vía Celery | — | Pending | — |
| T072 | Trocear routines/tests.py en paquete | T070 | Pending | — |
| T073 | Trocear users/ y notifications/tests.py en paquetes | T071 | Pending | — |
| T074 | contact_delete vía through + límite de diseño del dashboard | — | Pending | — |
| T075 | SettingsPage en secciones autocontenidas | — | Pending | — |
| T076 | useRoutineForm + secciones para RoutineFormPage | — | Pending | — |
| T077 | Mismo patrón en RoutineDetailPage y StockFormPage | T076 | Pending | — |
| T078 | Job de CI test-e2e con chromium-preview | — | Pending | — |
| T079 | requirements.in + requirements.lock con hashes | — | Pending | — |
| T080 | Auditoría de dependencias en CI + Dependabot | T079 | Pending | — |
| T081 | Backend: refresh token en cookie httpOnly | T060 | Pending | — |
| T082 | Frontend: access token en memoria, refresh por cookie | T081 | Pending | — |
| T083 | E2E de la migración de auth | T082, T078 | Pending | — |
| T084 | Retirar signals: efectos explícitos en servicios | T066 | Pending | — |

### Execution order

```
A:  T054        T055                          (independientes)

B:  T056 ──→ T057 ──→ T058 ──→ T059
                │
E:              └──→ T066 ──→ T069 ──→ T070 ──→ T072      T067   T068
                       │
J:                     └──→ T084

C:  T060   T061   T062   T063                 (independientes)
      │
J:    └──→ T081 ──→ T082 ──→ T083
                               ↑
I:  T078 ──────────────────────┘      T079 ──→ T080

D:  T064 ──→ T065              (frontend tolerante ANTES que backend)

G:  T071 ──→ T073          T074       (T074 independiente)

H:  T075        T076 ──→ T077
```

### Notes

- **Orden de despliegue acoplado**: T064 antes que T065 (el cliente debe
  tratar 409 como reintentable antes de que el servidor lo emita); T081
  mantiene compatibilidad body/cookie para que el frontend pre-T082 siga
  funcionando.
- **T066, T069, T070, T072, T081, T084 llevan aviso de re-lectura** en su
  Context: dependen de código que tareas anteriores de la serie reescriben.
- La rama en vuelo `feat/manual-serial-and-faster-lot-entry` toca lotes;
  mergearla antes de arrancar la oleada B (T056+).
