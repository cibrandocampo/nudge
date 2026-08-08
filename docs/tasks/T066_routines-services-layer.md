# T066 — Capa de servicios en routines: log_routine, consume_stock, undo_entry

## Context

Hallazgo A3 de `docs/technical-review.md`: las transacciones de dominio viven
dentro de métodos de viewset — `RoutineViewSet.log` (`views.py:275-332`),
`StockViewSet.consume` (`views.py:136-172`) y la restauración de lotes de
`RoutineEntryViewSet.destroy` (`views.py:406-468`). La app `users` tiene
`services.py`; `routines`, la de más lógica, no. Plan:
`docs/plans/technical-review-remediation.md`, oleada E.

**⚠️ Releer contra el árbol actual antes de ejecutar**: T057 habrá modificado
`consume` y `log` (serializer de entrada, invariante). Los números de línea de
arriba son del árbol pre-oleada-B; los anclajes conceptuales (nombres de
método) son los válidos.

**Dependencies**: T057.

## Objective

`apps/routines/services.py` contiene las tres operaciones de dominio; las
vistas quedan en validar entrada → llamar servicio → serializar salida. Cero
cambios de comportamiento observable: la suite existente pasa **sin editar
asserts**.

## Step 1 — `services.py` con las tres funciones

```python
@transaction.atomic
def log_routine(routine, user, *, notes="", client_created_at=None, lot_selections=None) -> RoutineEntry: ...

@transaction.atomic
def consume_stock(stock, user, *, quantity, lot_selections=None, client_created_at=None) -> list[dict]: ...

@transaction.atomic
def undo_entry(entry) -> None: ...
```

Mover los cuerpos actuales tal cual (incluidos logging, reset de
`NotificationState`, `stock.save(update_fields=["updated_at"])` y el matching
de seriales del undo con su invariante no-merge de T023). Las funciones lanzan
las excepciones de dominio de T056; no importan nada de `rest_framework`.

Regla: **mover, no mejorar**. Cualquier tentación de refactor adicional se
anota como follow-up.

## Step 2 — Adelgazar las vistas

- `log`: pre-check de stock (cortesía UX) + serializer de entrada + llamada +
  `RoutineEntrySerializer(entry)`.
- `consume`: serializer de entrada + llamada + re-serialización del stock.
- `RoutineEntryViewSet.destroy`: check de owner (HTTP) + `undo_entry(entry)` +
  204.

El check "solo el owner borra" se queda en la vista: es una regla de
autorización HTTP, no de dominio.

## Step 3 — Tests

- La suite existente pasa sin tocar asserts (guardarraíl del refactor).
- Tests nuevos directos a servicio (sin cliente HTTP): `log_routine` crea
  entry + consume + resetea NotificationState; `undo_entry` restaura lotes
  serializados y no serializados; `consume_stock` respeta el invariante de
  T057. Estos tests son los que ganan al desacoplar: rápidos y sin DRF.

## DoD — Definition of Done

1. Suite backend completa en verde **sin modificar ningún assert existente** (`git diff` de tests solo añade, no edita — salvo imports).
2. `grep -c "transaction.atomic" backend/apps/routines/views.py` → 0 (las transacciones viven en el servicio).
3. Tests nuevos de servicio presentes y en verde.
4. Cobertura ≥ 95 %; `ruff check .` limpio.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Suite completa | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test 2>&1 \| tail -5` | `backend_tests.txt` | "OK", 0 failures |
| 2 | Asserts intactos | `git diff --stat backend/apps/routines/tests.py` + revisión del diff | `tests_diff.txt` | Solo adiciones/imports |
| 3 | Vistas sin transacciones | `grep -n "transaction" backend/apps/routines/views.py` | `views_thin.txt` | Sin `transaction.atomic` |

## Files to create/modify

| File | Action |
|------|--------|
| `backend/apps/routines/services.py` | CREATE |
| `backend/apps/routines/views.py` | MODIFY |
| `backend/apps/routines/tests.py` | MODIFY (solo añadir) |
