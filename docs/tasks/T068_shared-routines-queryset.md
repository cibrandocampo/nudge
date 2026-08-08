# T068 — `routines_for_user`: queryset y prefetch budget en un único sitio

## Context

Hallazgo A7 de `docs/technical-review.md`: `dashboard()`
(`backend/apps/routines/views.py:471-511`) duplica el queryset + prefetches de
`RoutineViewSet.get_queryset` (`views.py:225-247`), reconocido en el propio
comentario ("Mirrors RoutineViewSet.get_queryset's prefetch budget"). Si el
presupuesto cambia en uno y no en otro, vuelven las N+1 silenciosas. Plan:
`docs/plans/technical-review-remediation.md`, oleada E.

**Dependencies**: None.

## Objective

Una única función construye el queryset de rutinas visibles con su prefetch
budget; el viewset y el dashboard la consumen.

## Step 1 — Módulo de queries

Crear `backend/apps/routines/queries.py`:

```python
def routines_for_user(user, *, active_only=False):
    """Visible routines (own + shared) with the full prefetch budget:
    _prefetched_entries, shared_with, stock__lots. See RoutineSerializer."""
```

Mover ahí el `Prefetch` de `latest_entry` y la cadena
`select_related`/`prefetch_related` actual. `active_only=True` añade
`is_active=True` (el filtro del dashboard).

## Step 2 — Consumidores

- `RoutineViewSet.get_queryset` → `return routines_for_user(self.request.user)`.
- `dashboard` → `routines_for_user(request.user, active_only=True)`.
- Trasladar el docstring del prefetch budget a la función (única fuente).

## Step 3 — Test de presupuesto de queries

Añadir (si no existe ya) un test con `assertNumQueries` sobre el dashboard y
sobre el list del viewset con N rutinas + stock + lotes: fija el número de
queries para que cualquier futura pérdida de prefetch falle en CI en ambos
consumidores a la vez.

## DoD — Definition of Done

1. Suite backend completa en verde sin editar asserts existentes.
2. `grep -c "prefetch_related" backend/apps/routines/views.py` → 0 para rutinas (solo puede quedar el de `StockViewSet`).
3. Test `assertNumQueries` presente para dashboard y para el list del viewset.
4. `ruff check .` limpio.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Suite completa | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test 2>&1 \| tail -5` | `backend_tests.txt` | "OK", 0 failures |
| 2 | Query budget | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test apps.routines -v 2 2>&1 \| grep -i queries` | `numqueries.txt` | Tests de presupuesto ok |

## Files to create/modify

| File | Action |
|------|--------|
| `backend/apps/routines/queries.py` | CREATE |
| `backend/apps/routines/views.py` | MODIFY |
| `backend/apps/routines/tests.py` | MODIFY (solo añadir) |
