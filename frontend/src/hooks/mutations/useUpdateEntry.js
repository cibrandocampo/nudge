import { useQueryClient } from '@tanstack/react-query'
import { registerRollback } from '../../offline/rollbacks'
import { useOfflineMutation } from '../useOfflineMutation'
import { restoreMatching, snapshotMatching } from './_optimisticHelpers'

// T114 — The optimistic patches every `['entries', …]` page and the
// matching `['routine-entries', …]` row. Persisting the pre-patch
// state per-page would balloon the queue entry; invalidate instead.
registerRollback('updateEntry', (qc, _args) => {
  qc.invalidateQueries({ queryKey: ['entries'] })
  qc.invalidateQueries({ queryKey: ['routine-entries'] })
})

/**
 * PATCH /api/entries/{id}/ — used exclusively to edit the free-text note
 * on a routine entry. Optimistic: patches every cached `['entries', …]`
 * page (HistoryPage uses infinite queries with filter keys) and every
 * cached `['routine-entries', …]` so the note appears instantly.
 */
export function useUpdateEntry() {
  const qc = useQueryClient()
  return useOfflineMutation({
    resourceKey: ({ entryId }) => `entry:${entryId}`,
    label: ({ routineName }) => ({
      key: 'offline.label.updateEntry',
      args: { routineName: routineName ?? '?' },
    }),
    rollback: ({ entryId }) => ({ type: 'updateEntry', args: { entryId } }),
    request: ({ entryId, patch, updatedAt }) => ({
      method: 'PATCH',
      path: `/entries/${entryId}/`,
      body: patch,
      ifUnmodifiedSince: updatedAt,
    }),
    optimistic: (client, { entryId, patch }) => {
      const id = Number(entryId)
      const entriesSnap = snapshotMatching(client, { queryKey: ['entries'] })
      const routineEntriesSnap = snapshotMatching(client, { queryKey: ['routine-entries'] })

      client.setQueriesData({ queryKey: ['entries'] }, (prev) => {
        if (!prev || !prev.pages) return prev
        return {
          ...prev,
          pages: prev.pages.map((page) => ({
            ...page,
            items: page.items.map((e) => (e.id === id ? { ...e, ...patch } : e)),
          })),
        }
      })
      client.setQueriesData({ queryKey: ['routine-entries'] }, (prev) => {
        if (!Array.isArray(prev)) return prev
        return prev.map((e) => (e.id === id ? { ...e, ...patch } : e))
      })

      return () => {
        restoreMatching(client, entriesSnap)
        restoreMatching(client, routineEntriesSnap)
      }
    },
    onSuccess: (data) => {
      if (data && !data.__queued && data.id) {
        qc.setQueriesData({ queryKey: ['entries'] }, (prev) => {
          if (!prev || !prev.pages) return prev
          return {
            ...prev,
            pages: prev.pages.map((p) => ({
              ...p,
              items: p.items.map((e) => (e.id === data.id ? { ...e, ...data } : e)),
            })),
          }
        })
      } else {
        qc.invalidateQueries({ queryKey: ['entries'] })
      }
      qc.invalidateQueries({ queryKey: ['routine-entries'] })
    },
  })
}
