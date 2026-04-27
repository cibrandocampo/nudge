import { useQueryClient } from '@tanstack/react-query'
import { useOfflineMutation } from '../useOfflineMutation'

/**
 * DELETE /api/entries/{entryId}/ — undoes a routine completion.
 *
 * The backend (T036 / RoutineEntryViewSet.destroy) removes the entry and
 * restores any `consumed_lots` back into the parent stock — either by
 * incrementing the existing lot quantity, or by recreating the lot if
 * the `delete_empty_lot` signal wiped it when the last unit was
 * consumed. From the client's perspective we simply invalidate every
 * cache the log-routine flow touched so the dashboard, inventory, and
 * history queries refetch the real state.
 *
 * Queueable (the default) so an offline Undo still enqueues. In
 * practice the toast's Undo button is visible only for a few seconds
 * after an online Mark-done, but having the mutation go through the
 * offline pipeline keeps behaviour consistent.
 */
export function useUndoLogRoutine() {
  const qc = useQueryClient()
  return useOfflineMutation({
    resourceKey: ({ entryId }) => `entry:${entryId}`,
    label: ({ routineName }) => ({
      key: 'offline.label.undoLogRoutine',
      args: { name: routineName ?? '?' },
    }),
    request: ({ entryId }) => ({
      method: 'DELETE',
      path: `/entries/${entryId}/`,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['routines'] })
      qc.invalidateQueries({ queryKey: ['entries'] })
      qc.invalidateQueries({ queryKey: ['routine-entries'] })
      qc.invalidateQueries({ queryKey: ['stock'] })
    },
  })
}
