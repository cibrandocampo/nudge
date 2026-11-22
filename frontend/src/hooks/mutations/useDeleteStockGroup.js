import { useQueryClient } from '@tanstack/react-query'
import { useOfflineMutation } from '../useOfflineMutation'

export function useDeleteStockGroup() {
  const qc = useQueryClient()
  return useOfflineMutation({
    queueable: false,
    request: ({ groupId }) => ({
      method: 'DELETE',
      path: `/stock-groups/${groupId}/`,
    }),
    onSuccess: (_data, { groupId }) => {
      qc.setQueryData(['stock-groups'], (prev = []) => prev.filter((g) => g.id !== groupId))
      // The category leaves every product that had it, so none keeps pointing
      // at a group that is gone until the refetch lands.
      qc.setQueryData(['stock'], (prev = []) =>
        prev.map((s) => ({
          ...s,
          ...(s.group === groupId && { group: null, group_name: null }),
          ...(s.my_groups && { my_groups: s.my_groups.filter((id) => id !== groupId) }),
        })),
      )
      qc.invalidateQueries({ queryKey: ['stock-groups'] })
      qc.invalidateQueries({ queryKey: ['stock'] })
    },
  })
}
