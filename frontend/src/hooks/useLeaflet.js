import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

// A leaflet changes rarely: once read it stays fresh for a day, and the
// persisted cache serves it offline for as long as the cache lives.
const LEAFLET_STALE_MS = 24 * 60 * 60 * 1000

/**
 * The sanitised patient leaflet of a stock (`GET /stock/{id}/leaflet/`).
 *
 * Asked for as soon as the product page shows the section (its titles are on
 * screen from the start); a day-long `staleTime` keeps that to about once a
 * day per product. A `404 leaflet_pending` — the backend has not downloaded it
 * yet — is data (`{ pending: true }`), not an error, and is never considered
 * fresh: the next mount or retry asks again.
 *
 * When the regulatory summary's `fetched_at` moves (a refresh or the daily
 * sync brought new data) the leaflet is invalidated, as the detail is; the
 * first render does not count as a move.
 */
export function useLeaflet(stockId, fetchedAt) {
  const qc = useQueryClient()
  const queryKey = ['stock', Number(stockId), 'leaflet']

  const seenFetchedAt = useRef(fetchedAt)
  useEffect(() => {
    if (seenFetchedAt.current === fetchedAt) return
    seenFetchedAt.current = fetchedAt
    qc.invalidateQueries({ queryKey: ['stock', Number(stockId), 'leaflet'], exact: true })
  }, [qc, stockId, fetchedAt])

  return useQuery({
    queryKey,
    queryFn: async () => {
      const res = await api.get(`/stock/${stockId}/leaflet/`)
      if (res.ok) return res.json()
      const body = await res.json().catch(() => null)
      if (res.status === 404 && body?.code === 'leaflet_pending') return { pending: true }
      const err = new Error(`GET leaflet ${stockId} failed`)
      err.status = res.status
      throw err
    },
    staleTime: (query) => (query.state.data?.pending ? 0 : LEAFLET_STALE_MS),
  })
}
