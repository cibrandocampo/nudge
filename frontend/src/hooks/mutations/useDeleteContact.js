import { useQueryClient } from '@tanstack/react-query'
import { useOfflineMutation } from '../useOfflineMutation'

export function useDeleteContact() {
  const qc = useQueryClient()
  return useOfflineMutation({
    queueable: false,
    request: ({ contactId }) => ({
      method: 'DELETE',
      path: `/auth/contacts/${contactId}/`,
    }),
    onSuccess: (_data, { contactId }) => {
      qc.setQueryData(['contacts'], (prev = []) => prev.filter((c) => c.id !== contactId))
    },
  })
}
