import { useQueryClient } from '@tanstack/react-query'
import { useOfflineMutation } from '../useOfflineMutation'

export function useCreateRoutine() {
  const qc = useQueryClient()
  return useOfflineMutation({
    queueable: false,
    request: ({ payload }) => ({
      method: 'POST',
      path: '/routines/',
      body: payload,
    }),
    onSuccess: (_data, { payload }) => {
      qc.invalidateQueries({ queryKey: ['routines'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      // When the caller backdates the creation with `last_done_at`, the
      // server writes a retroactive RoutineEntry — audit caches become
      // stale until they refetch.
      if (payload?.last_done_at) {
        qc.invalidateQueries({ queryKey: ['entries'] })
      }
    },
  })
}
