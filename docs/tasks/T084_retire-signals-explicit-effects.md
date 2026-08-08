# T084 — Retirar signals: efectos explícitos en la capa de servicios

## Context

Hallazgo A4 de `docs/technical-review.md`: `delete_empty_lot` (post_save que
borra lotes a 0, `routines/models.py:272-275`) y `unlink_routines_on_unshare`
(m2m_changed, `models.py:278-286`) esconden mutaciones importantes en flujo
implícito. El serializer ya paga el precio con un skip "defensivo" de lotes a
0 ("bulk paths can leave stragglers"). Con la capa de servicios de T066
asentada, los efectos pasan a ser llamadas explícitas. Plan:
`docs/plans/technical-review-remediation.md`, oleada J.

**⚠️ Releer contra el árbol actual**: T066 (servicios), T069/T070 (métricas) y
T074 (contact_delete, que ya tuvo que lidiar con el no-disparo del signal en
deletes de through) habrán movido los call sites. Inventariar antes de tocar.

**Dependencies**: T066.

## Objective

Ningún `@receiver` en `apps/routines`; los mismos efectos ocurren como pasos
explícitos de las operaciones que los causan, con la semántica actual
preservada y testeada.

## Step 1 — Inventario de disparadores reales

Antes de retirar nada, listar todos los caminos que hoy dependen de cada
signal:

- `delete_empty_lot`: consumo (FEFO/explícito vía `consume_lots`), PATCH
  manual de un lote a 0 (`StockLotViewSet`), undo que deja cantidades raras,
  admin de Django.
- `unlink_routines_on_unshare`: `StockSerializer` update de `shared_with`
  (remove/clear), `contact_delete` (post-T074 ya replica el efecto), admin.

El inventario se adjunta como evidencia — es lo que garantiza que no queda un
camino huérfano.

## Step 2 — Efectos explícitos

- `delete_empty_lot` → función `prune_empty_lots(stock)` en
  `routines/services.py`, llamada al final de `consume_stock`, `log_routine`,
  `undo_entry` y del update de lote del viewset. Para el admin: aceptar que un
  lote a 0 creado por admin persiste (documentarlo en el docstring) — el
  admin es herramienta de operador, no camino de usuario.
- `unlink_routines_on_unshare` → función `unshare_stock(stock, user_ids)` (o
  parámetro del servicio de update) invocada desde el punto donde el viewset
  procesa `shared_with`; `contact_delete` ya llama a su equivalente (T074).
- Borrar ambos `@receiver` y sus imports de signals.
- Eliminar el skip defensivo del serializer/módulo de métricas
  (`if lot.quantity <= 0: continue`) **solo si** el inventario demuestra que
  ya no pueden existir lotes a 0 tras las operaciones de usuario; si el admin
  puede crearlos, el skip se queda con un comentario actualizado que diga por
  qué (admin-only).

## Step 3 — Tests

- Los tests existentes de los efectos (borrado de lote vacío tras consumo,
  unlink al des-compartir) deben pasar **sin editar asserts** — cambia el
  mecanismo, no el comportamiento.
- Test nuevo: el camino bulk que antes dejaba "stragglers" ya no los deja (o
  está documentado como admin-only).
- `grep -rn "@receiver" backend/apps/routines/` → 0.

## DoD — Definition of Done

1. Suite backend completa en verde sin editar asserts existentes.
2. `grep -rn "@receiver\|post_save\|m2m_changed" backend/apps/routines/models.py` → 0.
3. Inventario de disparadores adjunto como evidencia con cada camino cubierto o documentado.
4. Suite E2E `chromium-preview` en verde (unshare.spec incluido — históricamente sensible, ver MEMORY.md).
5. Cobertura ≥ 95 %; `ruff check .` limpio.

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Sin receivers | `grep -rn "@receiver" backend/apps/routines/ --include='*.py'` | `no_receivers.txt` | Vacío |
| 2 | Suite completa | `… manage.py test 2>&1 \| tail -5` | `backend_tests.txt` | "OK", 0 failures |
| 3 | Inventario | Documento del paso 1 | `trigger_inventory.md` | Todos los caminos mapeados |
| 4 | E2E unshare | `docker run … npx playwright test unshare sharing --project=chromium-preview 2>&1 \| tail -5` | `e2e_unshare.txt` | 0 failed |

## Files to create/modify

| File | Action |
|------|--------|
| `backend/apps/routines/models.py` | MODIFY (retirar receivers) |
| `backend/apps/routines/services.py` | MODIFY (`prune_empty_lots`, `unshare_stock`) |
| `backend/apps/routines/views.py` | MODIFY (call sites) |
| `backend/apps/routines/serializers.py` o `stock_metrics.py` | MODIFY (skip defensivo) |
| Tests de routines | MODIFY (solo añadir) |
