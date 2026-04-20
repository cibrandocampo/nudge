import { useSyncExternalStore } from 'react'
import { getReachable, subscribe } from '../offline/reachability'

/**
 * Reactive accessor to the offline reachability state. Returns `true` when
 * the backend is reachable, `false` when the last observed request failed
 * with a network error and the health poll hasn't recovered yet.
 *
 * Uses `useSyncExternalStore` to guarantee tearing-free reads across
 * concurrent renders and to match the pattern already used by
 * `useQueueEntries`.
 */
export function useServerReachable() {
  return useSyncExternalStore(subscribe, getReachable, getReachable)
}
