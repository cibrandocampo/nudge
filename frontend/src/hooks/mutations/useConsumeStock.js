import { useQueryClient } from '@tanstack/react-query'
import { registerRollback } from '../../offline/rollbacks'
import { consumptionOrder, expiryToday } from '../../utils/lotsForSelection'
import { useOfflineMutation } from '../useOfflineMutation'
import { restoreKeys, snapshotKeys } from './_optimisticHelpers'

/**
 * T113 — Inverse of `applyConsumption`. Given the same args the
 * optimistic produced (`stockId`, `quantity`, `lotSelections`),
 * increment the cached `quantity` by `quantity` and restore each lot's
 * quantity from `lotSelections`. Composable across multiple consumes
 * on the same stock — each discard adds back its own delta
 * independently.
 *
 * Lots that the optimistic filtered out (their quantity hit 0) get
 * re-inserted as stubs so the stock detail page shows them again. The
 * stub is intentionally minimal — the next refetch (when online)
 * repaints the canonical lot fields (expiry_date, lot_number,
 * created_at, etc.).
 */
registerRollback('consumeStock', (qc, { stockId, quantity, lotSelections }) => {
  const id = Number(stockId)
  const qty = Number(quantity) || 0
  const restoreLots = (lots) => {
    if (!Array.isArray(lots)) return lots
    if (Array.isArray(lotSelections) && lotSelections.length > 0) {
      const bySel = new Map(lotSelections.map((sel) => [sel.lot_id, sel.quantity]))
      const seen = new Set()
      const next = lots.map((lot) => {
        const add = bySel.get(lot.id) ?? 0
        seen.add(lot.id)
        if (add <= 0) return lot
        return { ...lot, quantity: lot.quantity + add }
      })
      for (const sel of lotSelections) {
        if (!seen.has(sel.lot_id) && sel.quantity > 0) {
          next.push({ id: sel.lot_id, quantity: sel.quantity })
        }
      }
      return next
    }
    // FEFO mode: applyConsumption decremented in expiry order without
    // recording which lots it touched. We can't pinpoint the exact
    // restore here; bumping the total quantity is the safest we can do
    // without a full snapshot. The next refetch reconciles lot-level
    // state.
    return lots
  }
  const restore = (stock) => {
    if (!stock) return stock
    return {
      ...stock,
      quantity: (stock.quantity ?? 0) + qty,
      ...(stock.quantity_available != null && { quantity_available: stock.quantity_available + qty }),
      lots: restoreLots(stock.lots),
    }
  }
  qc.setQueryData(['stock'], (prev) => {
    if (!Array.isArray(prev)) return prev
    return prev.map((s) => (s.id === id ? restore(s) : s))
  })
  qc.setQueryData(['stock', id], (prev) => restore(prev))
})

/**
 * POST /api/stock/{id}/consume/
 *
 * Optimistic: decrements the total `quantity` and reduces the per-lot
 * quantities. When `lotSelections` is provided we apply them exactly;
 * otherwise we follow `consumptionOrder`, the server's own order.
 * Keeps the UI in sync immediately; the server's response overwrites on
 * `onSuccess`.
 */
export function useConsumeStock() {
  const qc = useQueryClient()
  return useOfflineMutation({
    resourceKey: ({ stockId }) => `stock:${stockId}`,
    label: ({ stockName, quantity }) => ({
      key: 'offline.label.consumeStock',
      args: { name: stockName ?? '?', qty: quantity },
    }),
    rollback: ({ stockId, quantity, lotSelections }) => ({
      type: 'consumeStock',
      args: { stockId, quantity, lotSelections },
    }),
    request: ({ stockId, quantity, lotSelections }) => ({
      method: 'POST',
      path: `/stock/${stockId}/consume/`,
      body: {
        quantity,
        lot_selections: lotSelections,
        client_created_at: new Date().toISOString(),
      },
    }),
    optimistic: (client, { stockId, quantity, lotSelections }) => {
      const id = Number(stockId)
      const snap = snapshotKeys(client, [['stock'], ['stock', id]])

      const applyToStock = (stock) => {
        if (!stock) return stock
        const lots = Array.isArray(stock.lots) ? applyConsumption(stock.lots, quantity, lotSelections) : stock.lots
        const nextQty = Math.max(0, (stock.quantity ?? 0) - quantity)
        // The row and the product page read `quantity_available` first, so a
        // queued consumption must move it too or the number would not change.
        return {
          ...stock,
          lots,
          quantity: nextQty,
          ...(stock.quantity_available != null && {
            quantity_available: Math.max(0, stock.quantity_available - quantity),
          }),
        }
      }

      client.setQueryData(['stock'], (prev) => {
        if (!Array.isArray(prev)) return prev
        return prev.map((s) => (s.id === id ? applyToStock(s) : s))
      })
      client.setQueryData(['stock', id], (prev) => applyToStock(prev))

      return () => restoreKeys(client, snap)
    },
    onError: () => {
      // The wrapper already put the snapshot back, but a refusal (above all
      // the 422 `insufficient_stock`) means that snapshot was stale too:
      // refetch so the lots on screen are the ones the server has.
      qc.invalidateQueries({ queryKey: ['stock'] })
    },
    onSuccess: (data, { stockId }) => {
      if (data && !data.__queued && data.id) {
        // The endpoint returns the updated Stock; merge it into the list
        // cache without a refetch.
        qc.setQueryData(['stock'], (prev = []) => prev.map((s) => (s.id === data.id ? data : s)))
        qc.setQueryData(['stock', Number(stockId)], data)
      }
      // When `__queued` (offline), the optimistic update already left
      // ['stock'] and ['stock', id] in the right state. Invalidating them
      // here would trigger a refetch that the Service Worker would serve
      // from its stale cache, overwriting the decrement and leaving the
      // user wondering whether the action took effect. Consolidation
      // happens later when the sync worker replays the mutation and the
      // backend response is merged via the branch above.
      qc.invalidateQueries({ queryKey: ['stock-consumptions'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

/**
 * Returns a new lots array with `quantity` units subtracted. Respects the
 * caller's lot_selections when provided; otherwise takes the units in
 * `consumptionOrder` — the same order the server uses, so an expired lot is
 * never touched and the opened box goes first.
 */
function applyConsumption(lots, quantity, lotSelections) {
  let deductions
  if (Array.isArray(lotSelections) && lotSelections.length > 0) {
    deductions = new Map(lotSelections.map((sel) => [sel.lot_id, sel.quantity]))
  } else {
    deductions = new Map()
    let remaining = quantity
    for (const lot of consumptionOrder(lots, expiryToday())) {
      if (remaining <= 0) break
      const take = Math.min(lot.quantity, remaining)
      deductions.set(lot.id, take)
      remaining -= take
    }
  }
  return lots
    .map((lot) => {
      const deduct = deductions.get(lot.id) ?? 0
      if (deduct <= 0) return lot
      return { ...lot, quantity: Math.max(0, lot.quantity - deduct) }
    })
    .filter((lot) => lot.quantity > 0)
}
