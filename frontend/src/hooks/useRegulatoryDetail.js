import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

/**
 * The full regulatory detail of a stock (`GET /stock/{id}/regulatory/`):
 * supply problems, safety notices and the agency link.
 *
 * The stock's own `regulatory` summary says whether there is anything to ask
 * for: only once the agency has answered with data (`fetched_at` set, and not
 * `not_found`). A refresh in flight (`pending`) or a failed one (`error`) keeps
 * the last good detail on screen, so those states still query.
 *
 * Persisted like every query, so the section reads offline. When the summary's
 * `fetched_at` moves — a refresh or the daily sync brought new data — the
 * detail is refetched; the first render does not count as a move, or every
 * mount would fetch it twice.
 */
export function useRegulatoryDetail(stockId, summary) {
  const qc = useQueryClient()
  const queryKey = ['stock', Number(stockId), 'regulatory']
  const fetchedAt = summary?.fetched_at ?? null
  const hasData = Boolean(fetchedAt) && summary?.fetch_status !== 'not_found'

  const seenFetchedAt = useRef(fetchedAt)
  useEffect(() => {
    if (seenFetchedAt.current === fetchedAt) return
    seenFetchedAt.current = fetchedAt
    qc.invalidateQueries({ queryKey: ['stock', Number(stockId), 'regulatory'], exact: true })
  }, [qc, stockId, fetchedAt])

  return useQuery({
    queryKey,
    queryFn: async () => {
      const res = await api.get(`/stock/${stockId}/regulatory/`)
      if (!res.ok) {
        const err = new Error(`GET regulatory ${stockId} failed`)
        err.status = res.status
        throw err
      }
      return res.json()
    },
    enabled: hasData,
  })
}
