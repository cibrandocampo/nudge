import { useQueryClient } from '@tanstack/react-query'
import { registerRollback } from '../../offline/rollbacks'
import { useOfflineMutation } from '../useOfflineMutation'
import { restoreKeys, snapshotKeys } from './_optimisticHelpers'

// T114 — The optimistic clears `['stock', id]` (sets it to undefined),
// so we can't rebuild the row from the detail cache. Invalidate the
// list and the (now-empty) detail so the next refetch reconciles.
registerRollback('deleteStock', (qc, { stockId }) => {
  const id = Number(stockId)
  qc.invalidateQueries({ queryKey: ['stock'] })
  qc.invalidateQueries({ queryKey: ['stock', id] })
})

/**
 * DELETE /api/stock/{id}/ — removes a stock item. Optimistic: drops the
 * item from the `['stock']` list and from `['stock', id]` so the UI
 * reflects the deletion without waiting for the network round-trip.
 */
export function useDeleteStock() {
  const qc = useQueryClient()
  return useOfflineMutation({
    resourceKey: ({ stockId }) => `stock:${stockId}`,
    label: ({ stockName }) => ({
      key: 'offline.label.deleteStock',
      args: { name: stockName ?? '?' },
    }),
    rollback: ({ stockId }) => ({ type: 'deleteStock', args: { stockId } }),
    request: ({ stockId, updatedAt }) => ({
      method: 'DELETE',
      path: `/stock/${stockId}/`,
      ifUnmodifiedSince: updatedAt,
    }),
    optimistic: (client, { stockId }) => {
      const id = Number(stockId)
      const snap = snapshotKeys(client, [['stock'], ['stock', id]])
      client.setQueryData(['stock'], (prev) => (Array.isArray(prev) ? prev.filter((s) => s.id !== id) : prev))
      client.setQueryData(['stock', id], undefined)
      return () => restoreKeys(client, snap)
    },
    onSuccess: (_data, { stockId }) => {
      qc.removeQueries({ queryKey: ['stock', Number(stockId)] })
      qc.invalidateQueries({ queryKey: ['stock'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['stock-consumptions'] })
    },
  })
}
