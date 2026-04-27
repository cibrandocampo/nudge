import { useQueryClient } from '@tanstack/react-query'
import { registerRollback } from '../../offline/rollbacks'
import { useOfflineMutation } from '../useOfflineMutation'
import { restoreKeys, snapshotKeys } from './_optimisticHelpers'

// T114 — Patches an arbitrary subset of the stock; invalidate the
// touched queries so the next refetch reconciles.
registerRollback('updateStock', (qc, { stockId }) => {
  const id = Number(stockId)
  qc.invalidateQueries({ queryKey: ['stock'] })
  qc.invalidateQueries({ queryKey: ['stock', id] })
})

/**
 * PATCH /api/stock/{id}/ — partial update (name, group, shared_with, …).
 *
 * Optimistic: patches the stock in both `['stock']` and `['stock', id]`.
 * On success also invalidates `['entries']` and `['stock-consumptions']`
 * because both carry `stock_name` (`routine.stock.name` on entries); a
 * rename otherwise leaves the audit page showing the old label.
 */
export function useUpdateStock() {
  const qc = useQueryClient()
  return useOfflineMutation({
    resourceKey: ({ stockId }) => `stock:${stockId}`,
    label: ({ stockName }) => ({
      key: 'offline.label.updateStock',
      args: { name: stockName ?? '?' },
    }),
    rollback: ({ stockId }) => ({ type: 'updateStock', args: { stockId } }),
    request: ({ stockId, patch, updatedAt }) => ({
      method: 'PATCH',
      path: `/stock/${stockId}/`,
      body: patch,
      ifUnmodifiedSince: updatedAt,
    }),
    optimistic: (client, { stockId, patch }) => {
      const id = Number(stockId)
      const snap = snapshotKeys(client, [['stock'], ['stock', id]])

      client.setQueryData(['stock'], (prev) => {
        if (!Array.isArray(prev)) return prev
        return prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
      })
      client.setQueryData(['stock', id], (prev) => (prev ? { ...prev, ...patch } : prev))

      return () => restoreKeys(client, snap)
    },
    onSuccess: (data, { stockId }) => {
      if (data && !data.__queued && data.id) {
        qc.setQueryData(['stock'], (prev = []) => prev.map((s) => (s.id === data.id ? data : s)))
        qc.setQueryData(['stock', Number(stockId)], data)
      } else {
        qc.invalidateQueries({ queryKey: ['stock'] })
      }
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      // Audit caches — `stock_name` appears on routine entries (via
      // `routine.stock.name`) and on every StockConsumption.
      qc.invalidateQueries({ queryKey: ['entries'] })
      qc.invalidateQueries({ queryKey: ['stock-consumptions'] })
    },
  })
}
