import { useQueryClient } from '@tanstack/react-query'
import { useOfflineMutation } from '../useOfflineMutation'
import { restoreKeys, snapshotKeys } from './_optimisticHelpers'

/**
 * POST /api/routines/{id}/log/
 *
 * Records a routine completion. If `lotSelections` is provided the backend
 * consumes exactly those lots; otherwise FEFO picks lots automatically. The
 * `client_created_at` is stamped at the time the user presses the button so
 * an offline entry synced hours later still reflects the real action time
 * (server supports this since T021).
 *
 * Optimistic: immediately removes the routine from the dashboard's `due`
 * list so the user sees it disappear. Next dashboard refetch places it
 * back in `upcoming` with the correct `next_due_at`. Also clears the
 * cached `['routine', id]` last-entry fields so the detail page reflects
 * the click right away.
 */
export function useLogRoutine() {
  const qc = useQueryClient()
  return useOfflineMutation({
    resourceKey: ({ routineId }) => `routine:${routineId}`,
    request: ({ routineId, notes, lotSelections }) => ({
      method: 'POST',
      path: `/routines/${routineId}/log/`,
      body: {
        notes: notes ?? '',
        lot_selections: lotSelections,
        client_created_at: new Date().toISOString(),
      },
    }),
    optimistic: (client, { routineId }) => {
      const id = Number(routineId)
      const snap = snapshotKeys(client, [['dashboard'], ['routine', id]])
      client.setQueryData(['dashboard'], (prev) => {
        if (!prev) return prev
        const due = (prev.due ?? []).filter((r) => r.id !== id)
        return { ...prev, due }
      })
      client.setQueryData(['routine', id], (prev) => {
        if (!prev) return prev
        return { ...prev, is_due: false, is_overdue: false, last_entry_at: new Date().toISOString() }
      })
      return () => restoreKeys(client, snap)
    },
    onSuccess: (_data, { routineId }) => {
      // Always invalidate — harmless when the mutation was queued offline
      // (TanStack Query won't refetch until the browser is back online).
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['routine', Number(routineId)] })
      qc.invalidateQueries({ queryKey: ['routine-entries', Number(routineId)] })
      qc.invalidateQueries({ queryKey: ['entries'] })
      qc.invalidateQueries({ queryKey: ['stock'] })
    },
  })
}
