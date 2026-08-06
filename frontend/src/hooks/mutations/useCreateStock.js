import { useQueryClient } from '@tanstack/react-query'
import { useOfflineMutation } from '../useOfflineMutation'

export function useCreateStock() {
  const qc = useQueryClient()
  return useOfflineMutation({
    queueable: false,
    request: ({ name, group, gtin, defaultLotQuantity }) => ({
      method: 'POST',
      path: '/stock/',
      body: {
        name,
        group: group ?? null,
        // Optional product identity. `''` and `null` are what the serializer
        // treats as "not known yet", so an untouched form sends exactly that.
        gtin: gtin ?? '',
        default_lot_quantity: defaultLotQuantity ?? null,
      },
    }),
    onSuccess: (data) => {
      if (data && !data.__queued) {
        // Append the server's response directly — the response body IS the
        // canonical new resource. Avoid a follow-up invalidate+refetch that
        // would just race this setQueryData.
        qc.setQueryData(['stock'], (prev = []) => {
          if (prev.some((s) => s.id === data.id)) return prev
          return [...prev, data].sort((a, b) => a.name.localeCompare(b.name))
        })
      } else {
        qc.invalidateQueries({ queryKey: ['stock'] })
      }
    },
  })
}
