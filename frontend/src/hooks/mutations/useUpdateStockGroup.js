import { useQueryClient } from '@tanstack/react-query'
import { useOfflineMutation } from '../useOfflineMutation'

export function useUpdateStockGroup() {
  const qc = useQueryClient()
  return useOfflineMutation({
    queueable: false,
    request: ({ groupId, patch }) => ({
      method: 'PATCH',
      path: `/stock-groups/${groupId}/`,
      body: patch,
    }),
    onSuccess: (data) => {
      if (data && !data.__queued && data.id) {
        qc.setQueryData(['stock-groups'], (prev = []) => prev.map((g) => (g.id === data.id ? data : g)))
      }
      qc.invalidateQueries({ queryKey: ['stock-groups'] })
      qc.invalidateQueries({ queryKey: ['stock'] })
    },
  })
}
