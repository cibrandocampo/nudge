import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'

/**
 * PUT /api/stock/{id}/my-groups/ — replaces the user's categories for a stock.
 *
 * Categories are personal, so a recipient of a shared stock can use it too.
 * Online-only, like the pin: it arranges the user's own list and nothing is
 * lost by asking again once back online.
 */
export function useSetMyStockGroups() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ stockId, groups }) => api.put(`/stock/${stockId}/my-groups/`, { groups }).then((r) => r.json()),
    onSuccess: (data) => {
      qc.setQueryData(['stock', data.id], data)
      qc.setQueryData(['stock'], (prev = []) => prev.map((s) => (s.id === data.id ? data : s)))
    },
  })
}
