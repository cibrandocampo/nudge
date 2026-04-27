import { useQueryClient } from '@tanstack/react-query'
import { registerRollback } from '../../offline/rollbacks'
import { useOfflineMutation } from '../useOfflineMutation'
import { restoreKeys, snapshotKeys } from './_optimisticHelpers'

/**
 * T114 — Inverse of the optimistic move (T112). If the routine sits in
 * `dashboard.upcoming` because of the optimistic, take it out and put
 * it back into `due` with `is_due: true`. If it isn't there (the
 * optimistic returned prev unchanged because the cache wasn't loaded
 * when the user clicked Done), no-op. Composable: discarding any one
 * of N queued logs of the same routine moves it back to `due` exactly
 * once; subsequent discards find the routine already there and no-op.
 */
registerRollback('logRoutine', (qc, { routineId }) => {
  const id = Number(routineId)
  qc.setQueryData(['dashboard'], (prev) => {
    if (!prev) return prev
    const upcoming = prev.upcoming ?? []
    const due = prev.due ?? []
    const routine = upcoming.find((r) => r.id === id)
    if (!routine) return prev
    const restored = { ...routine, is_due: true, is_overdue: true, last_entry_at: null }
    return {
      ...prev,
      upcoming: upcoming.filter((r) => r.id !== id),
      due: [...due, restored],
    }
  })
  qc.setQueryData(['routine', id], (prev) =>
    prev ? { ...prev, is_due: true, is_overdue: true, last_entry_at: null } : prev,
  )
})

/**
 * POST /api/routines/{id}/log/
 *
 * Records a routine completion. If `lotSelections` is provided the backend
 * consumes exactly those lots; otherwise FEFO picks lots automatically. The
 * `client_created_at` is stamped at the time the user presses the button so
 * an offline entry synced hours later still reflects the real action time
 * (server supports this since T021).
 *
 * Optimistic (T112): moves the routine from `dashboard.due` to
 * `dashboard.upcoming` with `next_due_at = now + interval_hours h`,
 * keeping `upcoming` sorted ascending by `next_due_at`. Online the
 * `onSuccess` invalidate triggers a refetch that replaces the local
 * approximation with the canonical backend value. Offline the
 * approximation persists until sync — without this move the routine
 * would vanish from both lists (Bug 1).
 *
 * Also clears the cached `['routine', id]` last-entry fields so the
 * detail page reflects the click right away.
 */
export function useLogRoutine() {
  const qc = useQueryClient()
  return useOfflineMutation({
    resourceKey: ({ routineId }) => `routine:${routineId}`,
    label: ({ routineName }) => ({
      key: 'offline.label.logRoutine',
      args: { name: routineName ?? '?' },
    }),
    rollback: ({ routineId }) => ({ type: 'logRoutine', args: { routineId } }),
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
        const due = prev.due ?? []
        const upcoming = prev.upcoming ?? []
        const routine = due.find((r) => r.id === id)
        if (!routine) return prev
        const now = Date.now()
        const intervalHours = routine.interval_hours ?? 0
        const nextDueAt = new Date(now + intervalHours * 3600 * 1000).toISOString()
        const moved = {
          ...routine,
          is_due: false,
          is_overdue: false,
          last_entry_at: new Date(now).toISOString(),
          next_due_at: nextDueAt,
          hours_until_due: intervalHours,
        }
        const newDue = due.filter((r) => r.id !== id)
        const newUpcoming = [...upcoming, moved].sort((a, b) =>
          (a.next_due_at ?? '').localeCompare(b.next_due_at ?? ''),
        )
        return { ...prev, due: newDue, upcoming: newUpcoming }
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
