# T070 — `stock_metrics.py`: tasas de consumo y estimación de agotamiento

## Context

Segunda mitad del hallazgo A2 (`docs/technical-review.md`):
`StockSerializer._consumption_data` (`serializers.py:326-408`) calcula las
tasas de consumo diario (rutinas activas + consumo directo con trigger B) y
la fecha estimada de agotamiento — ~80 líneas de heurística de negocio en el
serializer. Plan: `docs/plans/technical-review-remediation.md`, oleada F.

**Dependencies**: T069 (el módulo y su patrón de delegación ya existen).

## Objective

La estimación de consumo/agotamiento vive en `stock_metrics.py` como función
pura; `StockSerializer` queda como capa de mapeo fino.

## Step 1 — Función pura

En `backend/apps/routines/stock_metrics.py`:

```python
@dataclass(frozen=True)
class ConsumptionEstimate:
    own: float | None
    shared: float | None
    depletion_date: date | None
    is_estimated: bool

def consumption_estimate(
    active_routines,       # iterables con interval_hours, stock_usage, user_id
    recent_consumptions,   # iterables con quantity, client_created_at, consumed_by_id
    quantity_available,
    owner_id,
    *, now=None, window_days=None, half_days=None,
) -> ConsumptionEstimate: ...
```

Copiar la semántica exacta de `_consumption_data`, incluidos: el trigger B
(≥1 unidad en cada mitad de la ventana), el tratamiento de `consumed_by_id
is None` como `own`, el redondeo a 2 decimales con `None` para tasas cero, y
el caso `qty_available == 0 → depletion hoy`.

## Step 2 — Delegación en el serializer

`_consumption_data` pasa a: recolectar entradas (prefetch-aware, como hoy) →
llamar a la función → cachear el dataclass. Los cuatro getters
(`get_estimated_depletion_date`, `get_depletion_is_estimated`,
`get_daily_consumption_own/shared`) leen del dataclass. `get_stock_severity`
(ya delegado en T069) recibe `depletion_date` del estimate.

## Step 3 — Tests

- Tests unitarios puros de `consumption_estimate`: solo rutinas; solo directo
  con y sin trigger; mixto; consumidor huérfano (None → own); ventana límite.
- Suite existente sin editar asserts.

## DoD — Definition of Done

1. Suite backend completa en verde sin editar asserts existentes.
2. `StockSerializer` ya no contiene aritmética de tasas: `grep -n "24.0 /" backend/apps/routines/serializers.py` vacío.
3. Tests puros del estimate ejecutan sin DB.
4. Cobertura ≥ 95 %; `ruff check .` limpio.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Suite completa | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test 2>&1 \| tail -5` | `backend_tests.txt` | "OK", 0 failures |
| 2 | Serializer fino | `wc -l backend/apps/routines/serializers.py` + `grep -c "def get_" backend/apps/routines/serializers.py` | `serializer_thin.txt` | Sin cuerpo de heurística; solo delegaciones |
| 3 | Cobertura | `docker compose --env-file .env -f dev/docker-compose.yml exec backend sh -c "coverage run manage.py test && coverage report" 2>&1 \| tail -3` | `coverage.txt` | TOTAL ≥ 95% |

## Files to create/modify

| File | Action |
|------|--------|
| `backend/apps/routines/stock_metrics.py` | MODIFY |
| `backend/apps/routines/serializers.py` | MODIFY |
| `backend/apps/routines/tests.py` | MODIFY |
