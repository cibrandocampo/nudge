# T057 — Invariante consumido==solicitado y serializer de entrada de consumo

## Context

Hallazgos C1 y C3 de `docs/technical-review.md` (el rojo de integridad):
`Stock.consume_lots` consume menos de lo pedido en silencio cuando el stock no
alcanza — tanto en FEFO (el bucle termina sin error) como en selección
explícita (`min(lot.quantity, qty)`) — y `StockConsumption`/`RoutineEntry`
registran la cantidad **solicitada**, no la consumida: la auditoría miente.
Además `lot_selections` admite `lot_id` duplicados y la cantidad se valida a
mano en la vista. Plan: `docs/plans/technical-review-remediation.md`, oleada B.

**Dependencies**: T056 (excepciones de dominio y handler).

## Objective

Un consumo que no puede satisfacerse íntegramente falla con
`InsufficientStock` (→ 422 vía handler de T056) y hace rollback; ninguna fila
de auditoría puede registrar más de lo realmente descontado. La entrada de
`consume` y `log` se valida con un serializer único.

## Step 1 — Invariante en `Stock.consume_lots`

En `backend/apps/routines/models.py`, al final de ambos caminos (FEFO y
explícito), antes de `return`:

```python
consumed_total = sum(c["quantity"] for c in consumed_lots)
if consumed_total != quantity:
    raise InsufficientStock(requested=quantity, available=consumed_total + <resto disponible>)
```

Para `available` usar la cantidad realmente consumible al inicio de la
operación (los lotes están bloqueados con `select_for_update`, el dato es
estable dentro de la transacción). El método está decorado con
`@transaction.atomic`: la excepción revierte los decrementos parciales.

En el camino explícito, además, si `sel["quantity"] > lot.quantity` se lanza
`InsufficientStock` directamente (el `min()` deja de recortar en silencio).

## Step 2 — Rechazar `lot_id` duplicados

En la validación del camino explícito (hoy `models.py:145-149`), detectar
duplicados y lanzar `InvalidLotSelection("Duplicate lot_id in selection.")`.
Nota: esta validación se moverá también al serializer (paso 3); el modelo la
mantiene como última defensa para llamadas programáticas.

## Step 3 — `ConsumeInputSerializer`

En `backend/apps/routines/serializers.py`:

```python
class LotSelectionSerializer(serializers.Serializer):
    lot_id = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1)


class ConsumeInputSerializer(serializers.Serializer):
    quantity = serializers.IntegerField(min_value=1, default=1)
    lot_selections = LotSelectionSerializer(many=True, required=False, allow_null=True)
    client_created_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate_client_created_at(self, value):
        return validate_client_created_at(value)

    def validate_lot_selections(self, value):
        # None/[] → FEFO. Duplicados → error.
        ...
```

Usarlo en `StockViewSet.consume` (sustituye el `int(request.data.get(...))`
manual de `views.py:143-148` y el `ClientTimestampInputSerializer` suelto) y
en `RoutineViewSet.log` (que hoy no valida `lot_selections` en absoluto).
`log` no acepta `quantity` (viene de `routine.stock_usage`): usar el
serializer con el campo omitido o un serializer hermano sin `quantity` —
decidir en implementación, sin duplicar la validación de selecciones.

## Step 4 — Tests

Backend (`apps.routines`):

1. FEFO con stock insuficiente → 422, `code=insufficient_stock`, y las
   cantidades de TODOS los lotes quedan como estaban (rollback verificado).
2. Selección explícita pidiendo más que el lote → 422 + rollback.
3. `lot_selections` con `lot_id` duplicado → 400.
4. `quantity=0` y `quantity=-1` en `consume` → 400 (por el serializer, ya no
   por el `if` manual).
5. El pre-check de `log` sigue devolviendo 422 rápido con stock a 0 (sin
   regresión del caso `pain_relief` documentado en `views.py:291-295`).
6. Caso feliz FEFO y explícito: `sum(consumed_lots) == quantity` en la
   respuesta y en la fila de auditoría.

## DoD — Definition of Done

1. Suite backend completa en verde: `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test`.
2. Los 6 tests del paso 4 existen y nombran el invariante (grep de `insufficient` sobre `apps/routines/tests.py` los localiza).
3. No queda ningún `int(request.data.get("quantity"...))` en `views.py`: `grep -n 'request.data.get("quantity"' backend/apps/routines/views.py` vacío.
4. Cobertura backend no baja del gate: la salida de `coverage run manage.py test` + `coverage report` ≥ 95 % (línea `TOTAL`).
5. `ruff check .` limpio.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Tests backend | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test apps.routines 2>&1 \| tail -5` | `routines_tests.txt` | "OK", 0 failures |
| 2 | Suite completa | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test 2>&1 \| tail -5` | `backend_tests.txt` | "OK", 0 failures |
| 3 | Rollback verificado | Test específico con salida verbose: `... manage.py test apps.routines -v 2 2>&1 \| grep -i insufficient` | `invariant_tests.txt` | Los tests del invariante listados como ok |
| 4 | Cobertura | `docker compose --env-file .env -f dev/docker-compose.yml exec backend sh -c "coverage run manage.py test && coverage report" 2>&1 \| tail -3` | `coverage.txt` | TOTAL ≥ 95% |

## Files to create/modify

| File | Action |
|------|--------|
| `backend/apps/routines/models.py` | MODIFY (invariante en `consume_lots`) |
| `backend/apps/routines/serializers.py` | MODIFY (`ConsumeInputSerializer`) |
| `backend/apps/routines/views.py` | MODIFY (`consume` y `log` usan el serializer) |
| `backend/apps/routines/tests.py` | MODIFY |
