import { useQueryClient } from '@tanstack/react-query'
import { useOfflineMutation } from '../useOfflineMutation'
import { restoreKeys, snapshotKeys } from './_optimisticHelpers'

/**
 * PATCH /api/stock/{stockId}/lots/{lotId}/ — updates fields (quantity,
 * expiry_date, lot_number) on a single lot. Optimistic: patches the lot
 * inside `stock.lots` and recomputes the stock's total quantity.
 */
export function useUpdateStockLot() {
  const qc = useQueryClient()
  return useOfflineMutation({
    resourceKey: ({ stockId, lotId }) => `stock:${stockId}:lot:${lotId}`,
    request: ({ stockId, lotId, patch, updatedAt }) => ({
      method: 'PATCH',
      path: `/stock/${stockId}/lots/${lotId}/`,
      body: patch,
      ifUnmodifiedSince: updatedAt,
    }),
    optimistic: (client, { stockId, lotId, patch }) => {
      const id = Number(stockId)
      const lid = Number(lotId)
      const snap = snapshotKeys(client, [['stock'], ['stock', id]])
      const patchLot = (stock) => {
        if (!stock || !Array.isArray(stock.lots)) return stock
        const lots = stock.lots.map((lot) => (lot.id === lid ? { ...lot, ...patch } : lot))
        const quantity = lots.reduce((sum, lot) => sum + (lot.quantity ?? 0), 0)
        return { ...stock, lots, quantity }
      }
      client.setQueryData(['stock'], (prev) => {
        if (!Array.isArray(prev)) return prev
        return prev.map((s) => (s.id === id ? patchLot(s) : s))
      })
      client.setQueryData(['stock', id], (prev) => patchLot(prev))
      return () => restoreKeys(client, snap)
    },
    onSuccess: (_data, { stockId }) => {
      qc.invalidateQueries({ queryKey: ['stock'] })
      qc.invalidateQueries({ queryKey: ['stock', Number(stockId)] })
      qc.invalidateQueries({ queryKey: ['stock-lots', Number(stockId)] })
    },
  })
}
