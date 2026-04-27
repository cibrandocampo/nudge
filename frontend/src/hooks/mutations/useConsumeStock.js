import { useQueryClient } from '@tanstack/react-query'
import { registerRollback } from '../../offline/rollbacks'
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
 * otherwise we emulate FEFO (expiry asc, nulls last, then created_at).
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
        return { ...stock, lots, quantity: nextQty }
      }

      client.setQueryData(['stock'], (prev) => {
        if (!Array.isArray(prev)) return prev
        return prev.map((s) => (s.id === id ? applyToStock(s) : s))
      })
      client.setQueryData(['stock', id], (prev) => applyToStock(prev))

      return () => restoreKeys(client, snap)
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
 * caller's lot_selections when provided; otherwise consumes in FEFO order
 * (expiry ascending, nulls last, ties broken by `created_at`).
 */
function applyConsumption(lots, quantity, lotSelections) {
  if (Array.isArray(lotSelections) && lotSelections.length > 0) {
    const bySel = new Map(lotSelections.map((sel) => [sel.lot_id, sel.quantity]))
    return lots
      .map((lot) => {
        const deduct = bySel.get(lot.id) ?? 0
        if (deduct <= 0) return lot
        return { ...lot, quantity: Math.max(0, lot.quantity - deduct) }
      })
      .filter((lot) => lot.quantity > 0)
  }
  const ordered = [...lots].sort(fefoCompare)
  let remaining = quantity
  const next = ordered.map((lot) => {
    if (remaining <= 0) return lot
    const consume = Math.min(lot.quantity, remaining)
    remaining -= consume
    return { ...lot, quantity: lot.quantity - consume }
  })
  return next.filter((lot) => lot.quantity > 0)
}

function fefoCompare(a, b) {
  const aDate = a.expiry_date ?? '9999-12-31'
  const bDate = b.expiry_date ?? '9999-12-31'
  if (aDate !== bDate) return aDate.localeCompare(bDate)
  return (a.created_at ?? '').localeCompare(b.created_at ?? '')
}
