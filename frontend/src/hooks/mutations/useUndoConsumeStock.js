import { useQueryClient } from '@tanstack/react-query'
import { useOfflineMutation } from '../useOfflineMutation'

/**
 * DELETE /api/stock-consumptions/{id}/ — undoes a stock consumption.
 *
 * The backend gives the units back to the lots they came from (only the
 * consumption's author may). No optimistic update: which lot gets them is the
 * server's to decide, so the caches are refetched.
 *
 * Keyed on the stock so it replays in order with that stock's other queued
 * changes, and the sync worker refreshes the stock's caches afterwards.
 */
export function useUndoConsumeStock() {
  const qc = useQueryClient()
  return useOfflineMutation({
    resourceKey: ({ stockId }) => `stock:${stockId}`,
    label: ({ stockName }) => ({
      key: 'offline.label.undoConsumeStock',
      args: { name: stockName ?? '?' },
    }),
    request: ({ consumptionId }) => ({
      method: 'DELETE',
      path: `/stock-consumptions/${consumptionId}/`,
    }),
    onSuccess: (data) => {
      // Queued: refetching now would only read the stale offline cache.
      if (data?.__queued) return
      qc.invalidateQueries({ queryKey: ['stock'] })
      qc.invalidateQueries({ queryKey: ['stock-consumptions'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
