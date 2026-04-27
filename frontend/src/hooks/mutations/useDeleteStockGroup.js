import { useQueryClient } from '@tanstack/react-query'
import { useOfflineMutation } from '../useOfflineMutation'

export function useDeleteStockGroup() {
  const qc = useQueryClient()
  return useOfflineMutation({
    queueable: false,
    label: ({ groupName }) => ({
      key: 'offline.label.deleteStockGroup',
      args: { name: groupName ?? '?' },
    }),
    request: ({ groupId }) => ({
      method: 'DELETE',
      path: `/stock-groups/${groupId}/`,
    }),
    onSuccess: (_data, { groupId }) => {
      qc.setQueryData(['stock-groups'], (prev = []) => prev.filter((g) => g.id !== groupId))
      // Stocks that pointed at the deleted group need their `group` field
      // cleared locally so they show up in the ungrouped section.
      qc.setQueryData(['stock'], (prev = []) =>
        prev.map((s) => (s.group === groupId ? { ...s, group: null, group_name: null } : s)),
      )
      qc.invalidateQueries({ queryKey: ['stock-groups'] })
      qc.invalidateQueries({ queryKey: ['stock'] })
    },
  })
}
