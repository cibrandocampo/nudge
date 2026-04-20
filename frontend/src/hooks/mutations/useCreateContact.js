import { useQueryClient } from '@tanstack/react-query'
import { useOfflineMutation } from '../useOfflineMutation'

export function useCreateContact() {
  const qc = useQueryClient()
  return useOfflineMutation({
    queueable: false,
    request: ({ username }) => ({
      method: 'POST',
      path: '/auth/contacts/',
      body: { username },
    }),
    onSuccess: (data) => {
      if (data && !data.__queued && data.id) {
        qc.setQueryData(['contacts'], (prev = []) => {
          if (prev.some((c) => c.id === data.id)) return prev
          return [...prev, data]
        })
      } else {
        qc.invalidateQueries({ queryKey: ['contacts'] })
      }
    },
  })
}
