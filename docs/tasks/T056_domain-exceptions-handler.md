# T056 — Excepciones de dominio y exception handler DRF

## Context

Hallazgo A1 de `docs/technical-review.md`: `backend/apps/routines/models.py`
importa `rest_framework.serializers` (línea 11) y `Stock.consume_lots` lanza
`serializers.ValidationError` desde la capa de dominio. El modelo conoce el
framework HTTP y no es reutilizable desde comandos o tareas Celery sin
arrastrar semántica DRF. Plan: `docs/plans/technical-review-remediation.md`,
oleada B. Esta tarea crea la infraestructura de excepciones; T057 la usa para
el invariante de consumo.

**Dependencies**: None.

## Objective

Existe `apps/routines/exceptions.py` con excepciones de dominio puras, un
exception handler de DRF las traduce a respuestas HTTP, y `models.py` ya no
importa nada de `rest_framework`.

## Step 1 — Crear las excepciones de dominio

`backend/apps/routines/exceptions.py`:

```python
class DomainError(Exception):
    """Base for routines-domain errors. Framework-free on purpose."""


class InsufficientStock(DomainError):
    def __init__(self, requested: int, available: int):
        self.requested = requested
        self.available = available
        super().__init__(f"Insufficient stock: requested {requested}, available {available}.")


class InvalidLotSelection(DomainError):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)
```

## Step 2 — Exception handler DRF

Crear `backend/apps/core/exception_handler.py` con un handler que delega en el
de DRF por defecto y añade la traducción de dominio:

- `InsufficientStock` → **422** con el shape que ya emite el pre-check de
  `RoutineViewSet.log` (`views.py:296-305`), para que el frontend actual lo
  entienda sin cambios:
  `{"detail": "...", "code": "insufficient_stock", "required": e.requested, "available": e.available}`.
- `InvalidLotSelection` → **400** `{"lot_selections": [e.reason]}` (mismo shape
  de error de campo que DRF).

Registrarlo en `REST_FRAMEWORK["EXCEPTION_HANDLER"]` en
`backend/nudge/settings.py` (hoy no hay handler custom; verificado).

## Step 3 — Sustituir los `serializers.ValidationError` de `models.py`

En `Stock.consume_lots` (`models.py:141-149`):

- `"Total quantity must equal quantity."` → `raise InvalidLotSelection(...)`.
- `"One or more lot_ids are invalid."` → `raise InvalidLotSelection(...)`.

Eliminar `from rest_framework import serializers` de `models.py`.
**No cambiar aún la semántica de consumo** (el invariante consumido==pedido es
T057); esta tarea solo cambia el tipo de las excepciones existentes.

## Step 4 — Ajustar tests afectados

Los tests que hoy asertan un 400 por esas dos validaciones deben seguir
pasando: para el caso "total mismatch" y "lot_ids inválidos" la respuesta HTTP
cambia de shape si antes venía envuelta por DRF. Ajustar los asserts al shape
nuevo del handler y añadir tests unitarios directos:

- `consume_lots` con selección malformada lanza `InvalidLotSelection` (sin
  cliente HTTP, test de modelo puro).
- El handler traduce `InsufficientStock(3, 1)` a 422 con `required=3`,
  `available=1` (test de vista mínima o del handler directamente).

## DoD — Definition of Done

1. `grep -n "rest_framework" backend/apps/routines/models.py` no devuelve nada.
2. Suite backend completa en verde: `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test`.
3. Existen tests que cubren: `InvalidLotSelection` desde `consume_lots` (unitario) y la traducción del handler a 400/422.
4. `ruff check .` y `ruff format --check .` limpios (dentro del contenedor backend).

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Sin DRF en models | `grep -c "rest_framework" backend/apps/routines/models.py; echo exit=$?` | `no_drf_in_models.txt` | count 0 / exit 1 |
| 2 | Tests backend | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test 2>&1 \| tail -5` | `backend_tests.txt` | "OK", 0 failures |
| 3 | Lint | `docker compose --env-file .env -f dev/docker-compose.yml exec backend ruff check . 2>&1` | `ruff.txt` | "All checks passed" |

## Files to create/modify

| File | Action |
|------|--------|
| `backend/apps/routines/exceptions.py` | CREATE |
| `backend/apps/core/exception_handler.py` | CREATE |
| `backend/nudge/settings.py` | MODIFY (EXCEPTION_HANDLER) |
| `backend/apps/routines/models.py` | MODIFY |
| `backend/apps/routines/tests.py` | MODIFY |
