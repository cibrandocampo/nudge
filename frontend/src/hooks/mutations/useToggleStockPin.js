import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'

/**
 * How many stocks a user may pin, mirroring the backend's
 * `STOCK_MAX_PINNED_ITEMS`.
 *
 * The server is the authority — it enforces the cap and answers 400 with
 * `code: "max_pinned_reached"`. This copy exists only so the UI can disable
 * the control *before* the user presses it and explain why, which is a better
 * experience than a rejection after the fact. If the two ever disagree
 * (the deployment overrides the env var), the server wins and the 400 handler
 * shows its number, not this one.
 */
export const MAX_PINNED = 4

/**
 * Pin or unpin a stock for the current user.
 *
 * **Online-only, deliberately not queueable.** Two reasons:
 *
 *   1. The cap on how many stocks may be pinned lives on the server
 *      (`STOCK_MAX_PINNED_ITEMS`). Offline the client cannot know whether a
 *      pin will be accepted — another device may have spent the budget — so
 *      queueing would defer a rejection the user can neither see nor act on
 *      at the time they made the choice.
 *   2. The queue exists so actions the user *performed* survive a dropout: a
 *      unit consumed, a routine completed. A pin is a preference about how a
 *      list is arranged, and nothing is lost by asking again when back online.
 *
 * So it stays a plain `useMutation`, like `useSetMyStockGroup` — the other
 * per-user setting on a stock. Callers gate the control on
 * `useServerReachable` and catch `OfflineError` for the case where the
 * connection drops between render and click. That catch is live code precisely
 * because this mutation is not queueable: a queueable one would enqueue and
 * resolve instead of throwing.
 *
 * The server answers a pin with the updated stock, so its response seeds both
 * caches for an instant repaint; an unpin answers 204 with no body, so the
 * flag is cleared locally instead. Either way the queries are then
 * invalidated, so the next fetch reconciles with the server rather than
 * trusting a hand-patched entry — `staleTime` is 30s, long enough for a
 * hand-patch to be all the list sees for the rest of a browsing session.
 *
 * Caveat that is **not** this hook's to fix: a hard reload within the
 * persister's throttle window starts a fresh QueryClient, rehydrates whatever
 * IndexedDB last flushed, and treats it as fresh — so a write made a moment
 * earlier can be missed. That is a property of the persisted-cache setup and
 * applies to every mutation; client-side navigation, which is how the app is
 * actually used, keeps the in-memory cache and is unaffected.
 */
export function useToggleStockPin() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ stockId, pinned }) => {
      if (pinned) {
        const res = await api.post(`/stock/${stockId}/pin/`)
        if (!res.ok) {
          const err = new Error(`Pin ${stockId} failed`)
          err.status = res.status
          err.body = await res.json().catch(() => null)
          throw err
        }
        return res.json()
      }
      const res = await api.delete(`/stock/${stockId}/pin/`)
      if (!res.ok) {
        const err = new Error(`Unpin ${stockId} failed`)
        err.status = res.status
        throw err
      }
      return null
    },
    onSuccess: (data, { stockId }) => {
      if (data) {
        qc.setQueryData(['stock', data.id], data)
        qc.setQueryData(['stock'], (prev = []) => prev.map((s) => (s.id === data.id ? data : s)))
      } else {
        qc.setQueryData(['stock', Number(stockId)], (prev) => (prev ? { ...prev, is_pinned: false } : prev))
        qc.setQueryData(['stock'], (prev = []) =>
          prev.map((s) => (s.id === Number(stockId) ? { ...s, is_pinned: false } : s)),
        )
      }
      // Prefix match: covers both `['stock']` and `['stock', id]`.
      qc.invalidateQueries({ queryKey: ['stock'] })
    },
  })
}
