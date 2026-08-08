# T072 — Trocear `routines/tests.py` en paquete `tests/`

## Context

Hallazgo Q2 de `docs/technical-review.md`: `backend/apps/routines/tests.py`
tiene 4.634 líneas (más lo que hayan añadido las oleadas B/E/F al llegar
aquí). Encontrar el test de una regla concreta es arqueología. Plan:
`docs/plans/technical-review-remediation.md`, oleada G. Se ejecuta después de
T070 para no trocear y remover en la misma serie.

**Dependencies**: T070.

## Objective

Los tests de routines viven en un paquete navegable por área; ni un solo test
cambia de cuerpo; el recuento de tests ejecutados es idéntico antes y después.

## Step 1 — Censo previo

```bash
docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test apps.routines -v 2 2>&1 | tail -3
```

Anotar el número exacto de tests (línea "Ran N tests"). Es el invariante del
refactor.

## Step 2 — Crear el paquete

```
backend/apps/routines/tests/
    __init__.py
    test_models.py          # Stock, StockLot, consume_lots, señales, Routine.next_due_at…
    test_stock_views.py     # StockViewSet, StockLotViewSet, consume
    test_routine_views.py   # RoutineViewSet, log, entries, dashboard
    test_entry_views.py     # RoutineEntryViewSet, StockConsumptionViewSet, undo
    test_serializers.py     # validaciones de serializer, flex-fields
    test_services.py        # los de T066 (si existen ya como bloque)
    test_stock_metrics.py   # los puros de T069/T070
    test_sharing.py         # shared_with, matriz de permisos (T063)
```

Mover clases **enteras** con cortar/pegar — sin editar cuerpos ni renombrar
clases; solo consolidar imports por fichero. Si una clase mezcla áreas,
moverla al fichero de su área dominante (no partirla). Borrar el `tests.py`
original al final.

El reparto exacto de ficheros puede ajustarse a lo que exista tras B/E/F;
el criterio es "un fichero por área funcional, ninguno > ~800 líneas".

## Step 3 — Verificación de equivalencia

```bash
docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test apps.routines -v 2 2>&1 | tail -3
```

Mismo "Ran N tests" que el censo del paso 1, 0 failures. La cobertura no debe
moverse (mismo código ejercitado).

## DoD — Definition of Done

1. `Ran N tests` idéntico pre/post (evidencias 1 y 2).
2. `backend/apps/routines/tests.py` no existe; existe el paquete `tests/`.
3. Ningún fichero del paquete supera ~800 líneas: `wc -l backend/apps/routines/tests/*.py`.
4. Suite completa del proyecto en verde; cobertura ≥ 95 %.
5. `git log --follow` conserva historia razonable (usar `git mv` como base del primer fichero si es viable; si no, anotar en el commit que es un split).

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Censo previo | `… manage.py test apps.routines -v 2 2>&1 \| tail -3` (antes) | `census_before.txt` | "Ran N tests … OK" |
| 2 | Censo posterior | ídem (después) | `census_after.txt` | Mismo N, OK |
| 3 | Tamaños | `wc -l backend/apps/routines/tests/*.py` | `file_sizes.txt` | Todos ≤ ~800 |

## Files to create/modify

| File | Action |
|------|--------|
| `backend/apps/routines/tests.py` | DELETE (movido) |
| `backend/apps/routines/tests/__init__.py` + 7-8 módulos | CREATE |
