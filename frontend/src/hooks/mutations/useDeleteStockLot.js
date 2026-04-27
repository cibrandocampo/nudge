import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { registerRollback } from '../../offline/rollbacks'
import { useOfflineMutation } from '../useOfflineMutation'
import { restoreKeys, snapshotKeys } from './_optimisticHelpers'

// T114 — The optimistic drops the lot from `stock.lots` and recomputes
// totals. Reconstructing the lot would require persisting it; invalidate
// the parent so the next refetch repaints both the lot and the totals.
registerRollback('deleteStockLot', (qc, { stockId }) => {
  const id = Number(stockId)
  qc.invalidateQueries({ queryKey: ['stock'] })
  qc.invalidateQueries({ queryKey: ['stock', id] })
  qc.invalidateQueries({ queryKey: ['stock-lots', id] })
})

/**
 * DELETE /api/stock/{stockId}/lots/{lotId}/ — removes a lot from its
 * parent stock. Optimistic: drops the lot from `stock.lots` and
 * recomputes the total `quantity` so the UI updates instantly.
 */
export function useDeleteStockLot() {
  const qc = useQueryClient()
  return useOfflineMutation({
    resourceKey: ({ stockId, lotId }) => `stock:${stockId}:lot:${lotId}`,
    label: ({ stockName }) => ({
      key: 'offline.label.deleteStockLot',
      args: { stockName: stockName ?? '?' },
    }),
    rollback: ({ stockId, lotId }) => ({ type: 'deleteStockLot', args: { stockId, lotId } }),
    request: ({ stockId, lotId, updatedAt }) => ({
      method: 'DELETE',
      path: `/stock/${stockId}/lots/${lotId}/`,
      ifUnmodifiedSince: updatedAt,
    }),
    optimistic: (client, { stockId, lotId }) => {
      const id = Number(stockId)
      const lid = Number(lotId)
      const snap = snapshotKeys(client, [['stock'], ['stock', id]])
      const dropLot = (stock) => {
        if (!stock || !Array.isArray(stock.lots)) return stock
        const lots = stock.lots.filter((lot) => lot.id !== lid)
        const quantity = lots.reduce((sum, lot) => sum + (lot.quantity ?? 0), 0)
        return { ...stock, lots, quantity }
      }
      client.setQueryData(['stock'], (prev) => {
        if (!Array.isArray(prev)) return prev
        return prev.map((s) => (s.id === id ? dropLot(s) : s))
      })
      client.setQueryData(['stock', id], (prev) => dropLot(prev))
      return () => restoreKeys(client, snap)
    },
    onSuccess: async (data, { stockId }) => {
      if (!(data && data.__queued)) {
        try {
          const res = await api.get(`/stock/${stockId}/`)
          if (res.ok) {
            const updated = await res.json()
            qc.setQueryData(['stock'], (prev = []) => prev.map((s) => (s.id === updated.id ? updated : s)))
            qc.setQueryData(['stock', Number(stockId)], updated)
          }
        } catch {
          qc.invalidateQueries({ queryKey: ['stock'] })
        }
      } else {
        qc.invalidateQueries({ queryKey: ['stock'] })
      }
      qc.invalidateQueries({ queryKey: ['stock-lots', Number(stockId)] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
