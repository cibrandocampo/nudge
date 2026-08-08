# T074 — `contact_delete` vía tabla through y límite de diseño del dashboard documentado

## Context

Hallazgo Q3 de `docs/technical-review.md`: `contact_delete`
(`backend/apps/users/views.py:228-235`) ejecuta cuatro bucles con una query
M2M por iteración para deshacer el sharing bidireccional; y `dashboard`
serializa todas las rutinas sin paginación con `is_due()` en Python — correcto
a escala doméstica pero sin el límite escrito en ningún sitio. Plan:
`docs/plans/technical-review-remediation.md`, oleada G.

**Dependencies**: None.

## Objective

El des-sharing al borrar un contacto se hace en un número constante de
queries, y el límite de diseño del dashboard queda documentado donde un futuro
mantenedor lo verá.

## Step 1 — Reescribir el cascade con las tablas through

```python
Routine.shared_with.through.objects.filter(
    Q(routine__user=request.user, user=target) | Q(routine__user=target, user=request.user)
).delete()
Stock.shared_with.through.objects.filter(
    Q(stock__user=request.user, user=target) | Q(stock__user=target, user=request.user)
).delete()
```

**Atención a los signals**: `unlink_routines_on_unshare`
(`routines/models.py:278-286`) escucha `m2m_changed`, que un `.delete()` sobre
la through **no dispara**. Hay que replicar su efecto explícitamente (update
de `Routine.stock=None` para rutinas del target que usaban stock del
requester y viceversa + limpieza de `UserStockGroup`), con un test que cubra
exactamente ese caso. Si al ejecutar esta tarea la oleada J (T084) ya retiró
los signals hacia servicios, usar la función de servicio equivalente.

Envolver todo en `transaction.atomic`.

## Step 2 — Test de comportamiento y de queries

1. Test funcional: A comparte rutina+stock con B, B comparte stock con A, un
   `Routine` de B usa el stock de A → borrar el contacto deja: sin sharing en
   ambas direcciones, `routine.stock=None` donde corresponde, overrides de
   grupo eliminados. (Si ya existe el test funcional, debe pasar sin editar
   asserts — es el guardarraíl.)
2. `assertNumQueries` sobre `contact_delete` con N recursos compartidos:
   número constante, independiente de N.

## Step 3 — Documentar el límite del dashboard

En el docstring de `dashboard` (o de `routines_for_user` si T068 ya existe):
"Sin paginación por diseño: pensado para uso personal/doméstico (< ~200
rutinas por usuario). Si el producto cambia de escala, paginar y precomputar
`is_due` en SQL." Añadir la misma nota a `docs/ARCHITECTURE.md` si tiene
sección de decisiones.

## DoD — Definition of Done

1. Suite backend completa en verde (test funcional del cascade sin editar asserts si ya existía).
2. `assertNumQueries` fija el número constante de queries del delete.
3. `grep -c "for routine in\|for stock in" backend/apps/users/views.py` → 0.
4. Nota de límite de diseño presente en el docstring del dashboard.
5. `ruff check .` limpio.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Suite completa | `docker compose --env-file .env -f dev/docker-compose.yml exec backend python manage.py test 2>&1 \| tail -5` | `backend_tests.txt` | "OK", 0 failures |
| 2 | Sin bucles | `grep -n "shared_with" backend/apps/users/views.py` | `no_loops.txt` | Solo operaciones through |
| 3 | Query count | `… test apps.users -v 2 2>&1 \| grep -i "queries\|contact_delete"` | `numqueries.txt` | Test de queries ok |

## Files to create/modify

| File | Action |
|------|--------|
| `backend/apps/users/views.py` | MODIFY |
| `backend/apps/users/tests.py` (o paquete post-T073) | MODIFY |
| `backend/apps/routines/views.py` | MODIFY (docstring dashboard) |
| `docs/ARCHITECTURE.md` | MODIFY (nota de escala) |
