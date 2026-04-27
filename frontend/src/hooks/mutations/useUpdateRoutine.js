import { useQueryClient } from '@tanstack/react-query'
import { registerRollback } from '../../offline/rollbacks'
import { useOfflineMutation } from '../useOfflineMutation'
import { restoreKeys, snapshotKeys } from './_optimisticHelpers'

// T114 — Update mutations apply an arbitrary `patch` to the optimistic
// caches; reverting the exact pre-patch fields would require persisting
// a snapshot. Pragmatic inverse: invalidate the touched queries so the
// next refetch (online) reconciles. Offline the patched values stay
// until reconnect — acceptable for the rare offline discard.
registerRollback('updateRoutine', (qc, { routineId }) => {
  const id = Number(routineId)
  qc.invalidateQueries({ queryKey: ['routine', id] })
  qc.invalidateQueries({ queryKey: ['routines'] })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
})

/**
 * PATCH /api/routines/{id}/ — partial update. The caller must pass the
 * `updated_at` it read from the server so the backend's OptimisticLocking
 * mixin (T020) can detect 412s; the api client translates it to the
 * `If-Unmodified-Since` header.
 *
 * Optimistic: patches `['routine', id]` + the matching row in
 * `['routines']` and in `['dashboard']` (both due and upcoming) so the
 * rename / description change / is_active toggle shows up immediately.
 *
 * On success also invalidates `['entries']` and `['routine-entries']`
 * because serialized entries carry `routine_name`; renaming would
 * otherwise leave the audit page showing the old label.
 */
export function useUpdateRoutine() {
  const qc = useQueryClient()
  return useOfflineMutation({
    resourceKey: ({ routineId }) => `routine:${routineId}`,
    label: ({ routineName }) => ({
      key: 'offline.label.updateRoutine',
      args: { name: routineName ?? '?' },
    }),
    rollback: ({ routineId }) => ({ type: 'updateRoutine', args: { routineId } }),
    request: ({ routineId, patch, updatedAt }) => ({
      method: 'PATCH',
      path: `/routines/${routineId}/`,
      body: patch,
      ifUnmodifiedSince: updatedAt,
    }),
    optimistic: (client, { routineId, patch }) => {
      const id = Number(routineId)
      const snap = snapshotKeys(client, [['routine', id], ['routines'], ['dashboard']])

      client.setQueryData(['routine', id], (prev) => (prev ? { ...prev, ...patch } : prev))
      client.setQueryData(['routines'], (prev) => {
        if (!Array.isArray(prev)) return prev
        return prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
      })
      client.setQueryData(['dashboard'], (prev) => {
        if (!prev) return prev
        const patchRow = (row) => (row.id === id ? { ...row, ...patch } : row)
        return {
          ...prev,
          due: (prev.due ?? []).map(patchRow),
          upcoming: (prev.upcoming ?? []).map(patchRow),
        }
      })

      return () => restoreKeys(client, snap)
    },
    onSuccess: (_data, { routineId }) => {
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['routine', Number(routineId)] })
      qc.invalidateQueries({ queryKey: ['routines'] })
      // Audit caches — entries and per-routine entry history carry
      // `routine_name`, which becomes stale after a rename.
      qc.invalidateQueries({ queryKey: ['entries'] })
      qc.invalidateQueries({ queryKey: ['routine-entries'] })
    },
  })
}
