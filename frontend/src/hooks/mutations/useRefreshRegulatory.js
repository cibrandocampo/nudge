import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'

/**
 * "Refresh info": ask the server to fetch the stock's regulatory data again
 * and to raise the official-name offer again.
 *
 * **Online-only, deliberately not queueable** — like `useToggleStockPin`.
 * A refresh is about getting fresh data now; replayed hours later from the
 * offline queue it would answer a question nobody is asking any more.
 *
 * The answer (`202`) is the stock as it stands. When a fetch was enqueued its
 * summary is `pending`, which makes the detail page poll until the fetch is
 * over; when the server skipped it (one less than a minute ago) nothing
 * changes and nothing polls.
 */
export function useRefreshRegulatory() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ stockId }) => {
      const res = await api.post(`/stock/${stockId}/regulatory/refresh/`)
      if (!res.ok) {
        const err = new Error(`Refresh ${stockId} failed`)
        err.status = res.status
        err.body = await res.json().catch(() => null)
        throw err
      }
      return res.json()
    },
    onSuccess: (data) => {
      qc.setQueryData(['stock', data.id], data)
      qc.setQueryData(['stock'], (prev = []) => prev.map((s) => (s.id === data.id ? data : s)))
    },
  })
}
