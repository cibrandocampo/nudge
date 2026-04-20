import { useQueryClient } from '@tanstack/react-query'
import { useOfflineMutation } from '../useOfflineMutation'
import { restoreMatching, snapshotMatching } from './_optimisticHelpers'

/**
 * PATCH /api/stock-consumptions/{id}/ — edits the note on a standalone
 * stock consumption. Optimistic: patches every cached
 * `['stock-consumptions', …]` query so the note appears instantly on
 * every open HistoryPage view.
 */
export function useUpdateConsumption() {
  const qc = useQueryClient()
  return useOfflineMutation({
    resourceKey: ({ consumptionId }) => `consumption:${consumptionId}`,
    request: ({ consumptionId, patch, updatedAt }) => ({
      method: 'PATCH',
      path: `/stock-consumptions/${consumptionId}/`,
      body: patch,
      ifUnmodifiedSince: updatedAt,
    }),
    optimistic: (client, { consumptionId, patch }) => {
      const id = Number(consumptionId)
      const snap = snapshotMatching(client, { queryKey: ['stock-consumptions'] })
      client.setQueriesData({ queryKey: ['stock-consumptions'] }, (prev) => {
        if (!Array.isArray(prev)) return prev
        return prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
      })
      return () => restoreMatching(client, snap)
    },
    onSuccess: (data) => {
      if (data && !data.__queued && data.id) {
        qc.setQueriesData({ queryKey: ['stock-consumptions'] }, (prev) => {
          if (!Array.isArray(prev)) return prev
          return prev.map((c) => (c.id === data.id ? { ...c, ...data } : c))
        })
      } else {
        qc.invalidateQueries({ queryKey: ['stock-consumptions'] })
      }
    },
  })
}
