import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { registerRollback } from '../../offline/rollbacks'
import { useOfflineMutation } from '../useOfflineMutation'
import { restoreKeys, snapshotKeys } from './_optimisticHelpers'

// T114 — The optimistic appends a temp lot with `id: -Date.now()`. The
// id isn't determinable from `vars`, so we can't pinpoint the temp row
// from the inverse. Invalidate the parent stock + the lot list so a
// refetch reconciles. Offline the temp lot stays visible until reconnect.
registerRollback('createStockLot', (qc, { stockId }) => {
  const id = Number(stockId)
  qc.invalidateQueries({ queryKey: ['stock'] })
  qc.invalidateQueries({ queryKey: ['stock', id] })
  qc.invalidateQueries({ queryKey: ['stock-lots', id] })
})

/**
 * POST /api/stock/{stockId}/lots/ — creates a new lot inside an existing
 * stock. Optimistic: appends a lot with a temporary negative id to
 * `stock.lots` and bumps the total `quantity` so the UI reflects the
 * addition immediately. `onSuccess` then re-fetches the whole stock so
 * the real lot id + updated totals land.
 */
export function useCreateStockLot() {
  const qc = useQueryClient()
  return useOfflineMutation({
    resourceKey: ({ stockId }) => `stock:${stockId}`,
    label: ({ stockName, quantity }) => ({
      key: 'offline.label.createStockLot',
      args: { stockName: stockName ?? '?', qty: quantity },
    }),
    rollback: ({ stockId }) => ({ type: 'createStockLot', args: { stockId } }),
    request: ({ stockId, quantity, expiryDate, lotNumber }) => ({
      method: 'POST',
      path: `/stock/${stockId}/lots/`,
      body: {
        quantity,
        expiry_date: expiryDate || null,
        lot_number: lotNumber || '',
      },
    }),
    optimistic: (client, { stockId, quantity, expiryDate, lotNumber }) => {
      const id = Number(stockId)
      const snap = snapshotKeys(client, [['stock'], ['stock', id]])
      const tempLot = {
        id: -Date.now(),
        quantity: Number(quantity) || 0,
        expiry_date: expiryDate || null,
        lot_number: lotNumber || '',
        created_at: new Date().toISOString(),
      }
      const addLot = (stock) => {
        if (!stock) return stock
        const lots = Array.isArray(stock.lots) ? [...stock.lots, tempLot] : stock.lots
        const nextQty = (stock.quantity ?? 0) + tempLot.quantity
        return { ...stock, lots, quantity: nextQty }
      }
      client.setQueryData(['stock'], (prev) => {
        if (!Array.isArray(prev)) return prev
        return prev.map((s) => (s.id === id ? addLot(s) : s))
      })
      client.setQueryData(['stock', id], (prev) => addLot(prev))
      return () => restoreKeys(client, snap)
    },
    onSuccess: async (data, { stockId }) => {
      if (data && !data.__queued) {
        // Refresh the parent stock so its `lots` array and computed totals
        // reflect the new lot without a list-wide refetch.
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
