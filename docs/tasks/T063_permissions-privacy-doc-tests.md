# T063 — Matriz de permisos y postura de privacidad: documento + tests que la congelan

## Context

Hallazgos C4 y S5 de `docs/technical-review.md`: el sharing tiene asimetrías
de permisos no escritas (crear lote = solo owner; editar/borrar lote =
cualquier usuario compartido; PATCH de notas de entrada = compartido, DELETE =
owner) y hay decisiones de privacidad tomadas implícitamente (enumeración de
emails en `login/start` y `contacts/`). El plan
(`docs/plans/technical-review-remediation.md`, oleada C) decidió: **documentar
y congelar el comportamiento actual**, no cambiarlo.

**Dependencies**: None.

## Objective

Existe `docs/permissions-and-privacy.md` con la matriz completa y la postura
de privacidad razonada, y cada celda de la matriz tiene un test que la fija —
de modo que cualquier cambio futuro de permisos sea una decisión consciente
que rompe un test, no un accidente.

## Step 1 — Levantar la matriz real desde el código

Recorrer los viewsets/vistas y anotar, por recurso y verbo, quién puede:
`Stock` (CRUD + `consume` + `my-group`), `StockLot` (create/patch/delete),
`StockGroup`, `Routine` (CRUD + `log` + `entries`), `RoutineEntry`
(list/retrieve/patch/delete), `StockConsumption` (list/patch), contactos y
`me`. Fuentes: `get_queryset` (visibilidad), `get_permissions` (IsOwner en
update/destroy de Stock/Routine), checks manuales
(`RoutineEntryViewSet.destroy`, `StockLotViewSet._get_stock_for_create`) y
los `read_only_fields` de serializers (qué puede tocar realmente un PATCH).

No fiarse del informe: verificar cada celda contra el código actual.

## Step 2 — Escribir `docs/permissions-and-privacy.md`

Estructura:

1. **Matriz de permisos**: tabla recurso × verbo con `owner` / `shared` /
   `—`, y una columna de notas para las celdas no obvias.
2. **Asimetrías intencionales**: crear-lote vs editar-lote; PATCH-notas vs
   DELETE-entrada. Para cada una, el razonamiento (consumo colaborativo:
   quien comparte tu botiquín puede gastar y anotar, pero no dar de alta
   inventario nuevo ni borrar tu historial).
3. **Postura de privacidad**: enumeración de emails aceptada en instancia
   pequeña/familiar — `login/start` devuelve 404 con self-signup off
   (trade-off UX explícito), `contacts/` distingue "no existe" (necesario
   para el flujo de añadir contacto). Condiciones que invalidarían la
   decisión (instancia abierta al público → revisar).

## Step 3 — Tests que congelan la matriz

En los `tests.py` de cada app, clase `PermissionMatrixTests` (o equivalente)
con un test por celda **no cubierta ya** por la suite. Como mínimo:

1. Usuario compartido puede PATCH un lote del stock compartido (200).
2. Usuario compartido NO puede crear lote en stock compartido (403).
3. Usuario compartido puede PATCH `notes` de una entrada ajena (200) pero un
   PATCH que intente cambiar otros campos no los altera (read-only).
4. Usuario compartido NO puede DELETE una entrada ajena (403).
5. Usuario compartido NO puede update/destroy del Stock/Routine (403,
   `IsOwner`).
6. Un tercero sin sharing no ve nada de lo anterior (404 en todos).

Cada test referencia la sección del doc en su docstring
(`See docs/permissions-and-privacy.md §matriz`).

## DoD — Definition of Done

1. `docs/permissions-and-privacy.md` existe y cubre todos los recursos de la API (checklist del paso 1 completa).
2. Suite backend completa en verde con los tests nuevos: `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test`.
3. `grep -rl "permissions-and-privacy" backend/apps/*/tests.py` devuelve al menos routines (los tests citan el doc).
4. Cobertura backend ≥ 95 %.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Tests de matriz | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test -v 2 2>&1 \| grep -i matrix` | `matrix_tests.txt` | Todos ok |
| 2 | Suite completa | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test 2>&1 \| tail -5` | `backend_tests.txt` | "OK", 0 failures |
| 3 | Doc completo | `wc -l docs/permissions-and-privacy.md && grep -c '^|' docs/permissions-and-privacy.md` | `doc_stats.txt` | Doc existe con tabla poblada |

## Files to create/modify

| File | Action |
|------|--------|
| `docs/permissions-and-privacy.md` | CREATE |
| `backend/apps/routines/tests.py` | MODIFY (tests de matriz) |
| `backend/apps/users/tests.py` | MODIFY (privacidad contactos) |
