# T067 — `check_precondition` compartida entre el mixin y `me`

## Context

Hallazgo A6 de `docs/technical-review.md`: `users.views.me`
(`backend/apps/users/views.py:167-186`) reimplementa a mano el protocolo de
bloqueo optimista que ya encapsula `OptimisticLockingMixin`
(`backend/apps/core/mixins.py:75-90`): parseo del header, truncado a segundo,
payload 412. Dos copias de un protocolo delicado divergen tarde o temprano.
Plan: `docs/plans/technical-review-remediation.md`, oleada E.

**Dependencies**: None.

## Objective

Una única función decide el resultado de la precondición
`If-Unmodified-Since`; el mixin y `me` la consumen.

## Step 1 — Extraer la función

En `backend/apps/core/mixins.py`:

```python
def check_precondition(request, instance, field="updated_at"):
    """Returns 'invalid' | 'conflict' | None (OK/absent header)."""
```

Devuelve un valor semántico, no una `Response`: el shape del 412 difiere entre
consumidores (el mixin serializa el recurso con neutralización flex-fields;
`me` serializa el user), así que la función solo decide, el llamador responde.
`OptimisticLockingMixin._check_precondition` pasa a delegar en ella.

## Step 2 — Migrar `me`

`users/views.py` sustituye su bloque manual por la función compartida,
manteniendo su payload actual (`UserSerializer` como `current`).

## Step 3 — Tests

La suite existente de ambos consumidores debe pasar sin editar asserts.
Añadir un test de la función pura: header inválido → `'invalid'`; server más
nuevo → `'conflict'`; igual o más viejo → `None`; microsegundos truncados en
ambos lados (el caso sutil que justifica la unificación).

## DoD — Definition of Done

1. Suite backend completa en verde sin editar asserts existentes.
2. `users/views.py` no contiene comparación manual de `settings_updated_at` con `.replace(microsecond=0)` — solo la llamada compartida: `grep -c "microsecond" backend/apps/users/views.py` → 0.
3. Test unitario de `check_precondition` con los 4 casos.
4. `ruff check .` limpio.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Suite completa | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test 2>&1 \| tail -5` | `backend_tests.txt` | "OK", 0 failures |
| 2 | Duplicación eliminada | `grep -n "microsecond" backend/apps/users/views.py backend/apps/core/mixins.py` | `dedup.txt` | Solo aparece en `core/mixins.py` |

## Files to create/modify

| File | Action |
|------|--------|
| `backend/apps/core/mixins.py` | MODIFY |
| `backend/apps/users/views.py` | MODIFY |
| `backend/apps/core/tests.py` | MODIFY |
