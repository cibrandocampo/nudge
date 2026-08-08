# T069 — `stock_metrics.py`: partición de cantidades y severidades

## Context

Hallazgo A2 de `docs/technical-review.md` (primera mitad): la regla "cantidad
disponible" existe dos veces — `Stock.quantity_available`
(`models.py:96-114`) y `StockSerializer._quantity_partition`
(`serializers.py:267-306`) — y las severidades (`get_stock_severity`,
`get_expiry_severity`) son reglas de negocio viviendo en el serializer. Plan:
`docs/plans/technical-review-remediation.md`, oleada F.

**⚠️ Releer contra el árbol actual**: la oleada E habrá movido vistas a
servicios; los anclajes de serializer citados no cambian, pero verificar.

**Dependencies**: T066.

## Objective

Un módulo de dominio puro contiene la partición y las severidades; modelo y
serializer delegan en él. La regla existe una sola vez.

## Step 1 — Módulo con funciones puras

`backend/apps/routines/stock_metrics.py`:

```python
@dataclass(frozen=True)
class QuantityPartition:
    available: int
    soon: int
    healthy: int
    expired: int

def partition_quantities(lots, *, today=None, warning_days=None) -> QuantityPartition: ...
def expiry_severity(lots, *, today=None, warning_days=None) -> str:  # 'reached'|'soon'|'ok'
def stock_severity(partition, depletion_date, *, today=None, critical_days=None, warning_days=None, low_threshold=None) -> str:  # 'critical'|'low'|'ok'
```

- Entrada: iterable de lotes (objetos con `quantity`/`expiry_date` — sirven
  modelos o stubs en tests). Sin ORM, sin `settings` implícitos: los umbrales
  entran como kwargs con default leído de settings en el borde
  (`partition_quantities(lots, warning_days=settings.STOCK_SEVERITY_WARNING_DAYS)`
  lo hace el llamador o un wrapper fino).
- Copiar la semántica EXACTA actual, buckets incluidos
  (`expired: <= today`, `soon: < cutoff`, etc.). Es un refactor, no un rediseño.

## Step 2 — Delegación

- `Stock.quantity_available` → `partition_quantities(...).available`
  (manteniendo el camino prefetch-aware vs aggregate: la función pura recibe
  la lista; el modelo decide de dónde salen los lotes, incluida la
  optimización de aggregate para el camino sin prefetch — conservarla).
- `StockSerializer._quantity_partition` → llama a la función y cachea el
  dataclass en el obj como hoy; `get_stock_severity` / `get_expiry_severity`
  delegan.

## Step 3 — Tests

- Migrar la lógica de los tests de severidad/partición existentes a tests
  unitarios puros del módulo (sin DB: stubs con `quantity`/`expiry_date`).
- Mantener un test de humo por campo en el serializer (que la delegación
  está cableada).
- La suite existente pasa sin editar asserts.

## DoD — Definition of Done

1. Suite backend completa en verde.
2. La partición existe una vez: `grep -n "expiry_date <= today\|expiry_date__gt" backend/apps/routines/serializers.py` no encuentra lógica de buckets (solo llamadas al módulo).
3. Tests unitarios puros del módulo ejecutan sin tocar la DB (verificable: corren dentro de `SimpleTestCase`).
4. Cobertura ≥ 95 %; `ruff check .` limpio.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Suite completa | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test 2>&1 \| tail -5` | `backend_tests.txt` | "OK", 0 failures |
| 2 | Tests puros | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test apps.routines -v 2 2>&1 \| grep -i metric` | `metrics_tests.txt` | Tests del módulo ok |
| 3 | Una sola implementación | `grep -rn "soon\b" backend/apps/routines/serializers.py \| head` | `single_impl.txt` | Sin lógica de buckets en serializer |

## Files to create/modify

| File | Action |
|------|--------|
| `backend/apps/routines/stock_metrics.py` | CREATE |
| `backend/apps/routines/models.py` | MODIFY (`quantity_available` delega) |
| `backend/apps/routines/serializers.py` | MODIFY |
| `backend/apps/routines/tests.py` | MODIFY |
