import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'

/**
 * Answer the official-name offer of a stock: adopt the agency's name
 * (`accept: true`) or keep the user's (`accept: false`).
 *
 * **Online-only, deliberately not queueable** — like `useToggleStockPin`.
 * The question is answered with the official name on screen; a queued answer
 * could land after a "Refresh info" that raised a newer offer, and silently
 * answer a question the user never saw. Callers show the offer only while the
 * server is reachable, and treat an `OfflineError` (the connection dropping
 * between render and click) as "not answered".
 *
 * A `409 official_name_unavailable` means the official name is gone (the code
 * no longer resolves). It is not an error for the user: the stock is refetched
 * and the offer, no longer pending, simply disappears.
 */
export function useAnswerNameOffer() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ stockId, accept }) => {
      const res = await api.post(`/stock/${stockId}/regulatory/name-offer/`, { accept })
      if (res.status === 409) return null
      if (!res.ok) {
        const err = new Error(`Name offer ${stockId} failed`)
        err.status = res.status
        err.body = await res.json().catch(() => null)
        throw err
      }
      return res.json()
    },
    onSuccess: (data, { accept }) => {
      if (data) {
        qc.setQueryData(['stock', data.id], data)
        qc.setQueryData(['stock'], (prev = []) => prev.map((s) => (s.id === data.id ? data : s)))
      }
      // Prefix match: the detail, the list, and anything keyed under a stock.
      qc.invalidateQueries({ queryKey: ['stock'] })
      if (accept) {
        // Accepting renames the stock, and its name also shows on routine
        // cards and in the history — the same caches `useUpdateStock` refreshes.
        qc.invalidateQueries({ queryKey: ['dashboard'] })
        qc.invalidateQueries({ queryKey: ['entries'] })
        qc.invalidateQueries({ queryKey: ['stock-consumptions'] })
      }
    },
  })
}
