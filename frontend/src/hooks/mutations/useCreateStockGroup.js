import { useQueryClient } from '@tanstack/react-query'
import { useOfflineMutation } from '../useOfflineMutation'

export function useCreateStockGroup() {
  const qc = useQueryClient()
  return useOfflineMutation({
    queueable: false,
    request: ({ name, displayOrder }) => ({
      method: 'POST',
      path: '/stock-groups/',
      body: { name, display_order: displayOrder ?? 0 },
    }),
    onSuccess: (data) => {
      if (data && !data.__queued && data.id) {
        qc.setQueryData(['stock-groups'], (prev = []) => {
          if (prev.some((g) => g.id === data.id)) return prev
          return [...prev, data]
        })
      }
      qc.invalidateQueries({ queryKey: ['stock-groups'] })
    },
  })
}
