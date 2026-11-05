import { useQueryClient } from '@tanstack/react-query'
import { registerRollback } from '../../offline/rollbacks'
import { useOfflineMutation } from '../useOfflineMutation'
import { restoreKeys, snapshotKeys } from './_optimisticHelpers'

// Upcoming is ordered by next due date; a routine without one sorts first.
const byNextDue = (a, b) => (a.next_due_at ?? '').localeCompare(b.next_due_at ?? '')

/**
 * T114 — Inverse of the optimistic move (T112), run when a queued offline
 * log is discarded. Two shapes, picked by where the caller found the routine:
 *
 * - From `due` (or an entry queued before T102, which carries no `from`): if
 *   the routine sits in `dashboard.upcoming` because of the optimistic, take
 *   it out and put it back into `due` with `is_due: true`. If it isn't there
 *   (the optimistic returned prev unchanged because the cache wasn't loaded
 *   when the user clicked Done), no-op. Composable: discarding any one of N
 *   queued logs of the same routine moves it back to `due` exactly once;
 *   subsequent discards find the routine already there and no-op.
 * - From `upcoming` (T102): the routine never left that list, so it stays
 *   there with its `previous` dates restored and `due` untouched.
 */
registerRollback('logRoutine', (qc, { routineId, from, previous }) => {
  const id = Number(routineId)
  if (from === 'upcoming' && previous) {
    // T102: completed from Upcoming, so it never left that list. Put its
    // previous dates back and re-sort; `due` is untouched.
    qc.setQueryData(['dashboard'], (prev) => {
      const upcoming = prev?.upcoming ?? []
      if (!upcoming.some((r) => r.id === id)) return prev
      return {
        ...prev,
        upcoming: upcoming.map((r) => (r.id === id ? { ...r, ...previous } : r)).sort(byNextDue),
      }
    })
    qc.setQueryData(['routine', id], (prev) => (prev ? { ...prev, ...previous } : prev))
    return
  }
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
 * `client_created_at` defaults to the moment the user presses the button so
 * an offline entry synced hours later still reflects the real action time
 * (server supports this since T021). A caller may also pass an explicit
 * `clientCreatedAt` (ISO string) to back-date the completion — e.g. the user
 * took the medication earlier and only logs it now. `created_at` stays the
 * server's audit timestamp regardless.
 *
 * Optimistic (T112): moves the routine from `dashboard.due` to
 * `dashboard.upcoming` (or, since T099, re-dates it in place when it was
 * already upcoming) with `next_due_at = now + interval_hours h`,
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
    // `from` / `previous` (T102): where the caller found the routine and, for
    // an upcoming one, the dates to restore if the queued entry is discarded.
    // Entries queued before T102 carry neither and keep the `due` behaviour.
    rollback: ({ routineId, from, previous }) => ({ type: 'logRoutine', args: { routineId, from, previous } }),
    request: ({ routineId, notes, lotSelections, clientCreatedAt }) => ({
      method: 'POST',
      path: `/routines/${routineId}/log/`,
      body: {
        notes: notes ?? '',
        lot_selections: lotSelections,
        client_created_at: clientCreatedAt ?? new Date().toISOString(),
      },
    }),
    optimistic: (client, { routineId, clientCreatedAt }) => {
      const id = Number(routineId)
      const snap = snapshotKeys(client, [['dashboard'], ['routine', id]])
      // Base the optimistic next-due / last-entry on the chosen completion
      // time (back-dated) when provided, so the offline approximation matches
      // what the server will compute; otherwise fall back to the wall clock.
      const now = clientCreatedAt ? new Date(clientCreatedAt).getTime() : Date.now()
      client.setQueryData(['dashboard'], (prev) => {
        if (!prev) return prev
        const due = prev.due ?? []
        const upcoming = prev.upcoming ?? []
        // T099: a routine can be completed from either list (the dashboard
        // swipe works on upcoming too). Both end up in `upcoming` with the
        // new next-due; filtering both lists by id replaces rather than
        // duplicates an upcoming one and leaves `due` untouched for it.
        const routine = due.find((r) => r.id === id) ?? upcoming.find((r) => r.id === id)
        if (!routine) return prev
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
        const newUpcoming = [...upcoming.filter((r) => r.id !== id), moved].sort(byNextDue)
        return { ...prev, due: newDue, upcoming: newUpcoming }
      })
      client.setQueryData(['routine', id], (prev) => {
        if (!prev) return prev
        return { ...prev, is_due: false, is_overdue: false, last_entry_at: new Date(now).toISOString() }
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
