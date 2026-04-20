import { useQueryClient } from '@tanstack/react-query'
import { useOfflineMutation } from '../useOfflineMutation'

export function useUpdateMe() {
  const qc = useQueryClient()
  return useOfflineMutation({
    queueable: false,
    request: ({ patch, updatedAt }) => ({
      method: 'PATCH',
      path: '/auth/me/',
      body: patch,
      ifUnmodifiedSince: updatedAt,
    }),
    onSuccess: (data) => {
      if (data && !data.__queued && data.id) {
        qc.setQueryData(['me'], (prev) => ({ ...(prev ?? {}), ...data }))
      } else {
        qc.invalidateQueries({ queryKey: ['me'] })
      }
    },
  })
}
