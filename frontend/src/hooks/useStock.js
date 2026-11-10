import { useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { findStockInCaches, stockSeedUpdatedAt } from '../utils/queryCacheLookup'

async function getJson(path) {
  const res = await api.get(path)
  if (!res.ok) {
    const err = new Error(`GET ${path} failed`)
    err.status = res.status
    throw err
  }
  return res.json()
}

export function useStockList() {
  return useQuery({
    queryKey: ['stock'],
    queryFn: async () => {
      const data = await getJson('/stock/')
      return data.results ?? data
    },
  })
}

// While the regulatory fetch of a stock is in flight the detail page asks again
// every few seconds, for at most a minute: the agency usually answers in a
// second or two, and with fetching off (E2E) nothing would ever answer.
export const REGULATORY_POLL_MS = 3000
export const REGULATORY_POLL_MAX_MS = 60_000

/**
 * How long until the next poll of a stock, or `false` to stop.
 *
 * Pure so the one-minute cap can be tested without timers. `wait` holds when
 * the current wait began (`since`); it is reset as soon as the stock is no
 * longer pending, so the next refresh gets its own minute.
 */
export function regulatoryPollInterval(stock, wait, now) {
  if (stock?.regulatory?.fetch_status !== 'pending') {
    wait.since = null
    return false
  }
  wait.since ??= now
  return now - wait.since < REGULATORY_POLL_MAX_MS ? REGULATORY_POLL_MS : false
}

/**
 * @param {number|string} id
 * @param {object} [options]
 * @param {boolean} [options.pollWhilePending] — refetch while the stock's
 *   regulatory data is being fetched (`regulatory.fetch_status === 'pending'`).
 *   Opt-in: only the detail page shows that data. The edit form must not poll —
 *   a refetch would reset the fields being typed.
 */
export function useStock(id, { pollWhilePending = false } = {}) {
  // Seed from the `['stock']` list cache when available so the detail
  // page renders immediately offline. Online, queryFn refetches in the
  // background. Mirrors the pattern in `useRoutine`.
  const queryClient = useQueryClient()
  // When the current wait started (see `regulatoryPollInterval`).
  const pendingWait = useRef({ since: null })
  return useQuery({
    queryKey: ['stock', Number(id)],
    queryFn: () => getJson(`/stock/${id}/`),
    enabled: id !== undefined && id !== null,
    initialData: () => findStockInCaches(queryClient, id),
    initialDataUpdatedAt: () => stockSeedUpdatedAt(queryClient),
    refetchInterval: pollWhilePending
      ? (query) => regulatoryPollInterval(query.state.data, pendingWait.current, Date.now())
      : false,
  })
}

export function useStockGroups() {
  return useQuery({
    queryKey: ['stock-groups'],
    queryFn: async () => {
      const data = await getJson('/stock-groups/')
      return data.results ?? data
    },
  })
}
