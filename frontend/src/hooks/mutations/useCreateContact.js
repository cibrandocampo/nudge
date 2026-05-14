import { useQueryClient } from '@tanstack/react-query'
import { useOfflineMutation } from '../useOfflineMutation'

// Post-T197: contacts are added by exact email match (no autocomplete).
// The backend resolves the email to an existing active user and returns
// the contact's serialized identity (no `username` exposed).
export function useCreateContact() {
  const qc = useQueryClient()
  return useOfflineMutation({
    queueable: false,
    request: ({ email }) => ({
      method: 'POST',
      path: '/auth/contacts/',
      body: { email },
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
