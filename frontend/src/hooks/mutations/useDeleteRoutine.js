import { useQueryClient } from '@tanstack/react-query'
import { registerRollback } from '../../offline/rollbacks'
import { useOfflineMutation } from '../useOfflineMutation'
import { restoreKeys, snapshotKeys } from './_optimisticHelpers'

/**
 * T114 — Inverse of the optimistic delete. The optimistic filters the
 * routine out of `['routines']` and `['dashboard']` but does NOT
 * `removeQueries(['routine', id])`, so the detail cache survives.
 * If we have it, we can rebuild the list entries from it; otherwise
 * fall back to invalidating the related queries so the next refetch
 * (online) reconciles.
 */
registerRollback('deleteRoutine', (qc, { routineId }) => {
  const id = Number(routineId)
  const detail = qc.getQueryData(['routine', id])
  if (!detail) {
    qc.invalidateQueries({ queryKey: ['routines'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    return
  }
  qc.setQueryData(['routines'], (prev) => {
    if (!Array.isArray(prev)) return prev
    if (prev.some((r) => r.id === id)) return prev
    return [...prev, detail]
  })
  qc.setQueryData(['dashboard'], (prev) => {
    if (!prev) return prev
    const bucket = detail.is_due ? 'due' : 'upcoming'
    const list = prev[bucket] ?? []
    if (list.some((r) => r.id === id)) return prev
    return { ...prev, [bucket]: [...list, detail] }
  })
})

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
    label: ({ routineName }) => ({
      key: 'offline.label.deleteRoutine',
      args: { name: routineName ?? '?' },
    }),
    rollback: ({ routineId }) => ({ type: 'deleteRoutine', args: { routineId } }),
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
    onSuccess: (data, { routineId }) => {
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['routines'] })
      qc.invalidateQueries({ queryKey: ['entries'] })
      // T114: only drop the detail cache when the mutation actually
      // succeeded on the server. Offline (`__queued`) we keep the
      // detail so the rollback registered for `deleteRoutine` can
      // rebuild the list rows from it if the user discards. The
      // detail entry will be cleaned up by the next refetch (or by
      // this same path running again with a fresh response).
      if (!data?.__queued) {
        qc.removeQueries({ queryKey: ['routine', Number(routineId)] })
        qc.removeQueries({ queryKey: ['routine-entries', Number(routineId)] })
      }
    },
  })
}
