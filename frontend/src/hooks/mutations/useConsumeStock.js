import { useQueryClient } from '@tanstack/react-query'
import { useOfflineMutation } from '../useOfflineMutation'
import { restoreKeys, snapshotKeys } from './_optimisticHelpers'

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
      } else {
        qc.invalidateQueries({ queryKey: ['stock'] })
      }
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
