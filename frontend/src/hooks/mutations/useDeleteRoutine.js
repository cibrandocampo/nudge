import { useQueryClient } from '@tanstack/react-query'
import { useOfflineMutation } from '../useOfflineMutation'
import { restoreKeys, snapshotKeys } from './_optimisticHelpers'

/**
 * DELETE /api/routines/{id}/ — respects optimistic locking when the caller
 * passes `updatedAt`. Optimistic: removes the routine from every list
 * cache (routines, dashboard.due, dashboard.upcoming) so the UI reflects
 * the deletion the moment the button is clicked.
 */
export function useDeleteRoutine() {
  const qc = useQueryClient()
  return useOfflineMutation({
    resourceKey: ({ routineId }) => `routine:${routineId}`,
    request: ({ routineId, updatedAt }) => ({
      method: 'DELETE',
      path: `/routines/${routineId}/`,
      ifUnmodifiedSince: updatedAt,
    }),
    optimistic: (client, { routineId }) => {
      const id = Number(routineId)
      const snap = snapshotKeys(client, [['routines'], ['dashboard']])

      client.setQueryData(['routines'], (prev) => (Array.isArray(prev) ? prev.filter((r) => r.id !== id) : prev))
      client.setQueryData(['dashboard'], (prev) => {
        if (!prev) return prev
        return {
          ...prev,
          due: (prev.due ?? []).filter((r) => r.id !== id),
          upcoming: (prev.upcoming ?? []).filter((r) => r.id !== id),
        }
      })

      return () => restoreKeys(client, snap)
    },
    onSuccess: (_data, { routineId }) => {
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['routines'] })
      qc.invalidateQueries({ queryKey: ['entries'] })
      qc.removeQueries({ queryKey: ['routine', Number(routineId)] })
      qc.removeQueries({ queryKey: ['routine-entries', Number(routineId)] })
    },
  })
}
