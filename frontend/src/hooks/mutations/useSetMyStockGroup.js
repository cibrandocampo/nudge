import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'

export function useSetMyStockGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ stockId, group }) => api.patch(`/stock/${stockId}/my-group/`, { group }).then((r) => r.json()),
    onSuccess: (data) => {
      qc.setQueryData(['stock', data.id], data)
      qc.setQueryData(['stock'], (prev = []) => prev.map((s) => (s.id === data.id ? data : s)))
    },
  })
}
