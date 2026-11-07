import { useEffect, useState } from 'react'
import { list, subscribe } from '../offline/queue'

// Every IndexedDB read returns fresh objects, so identity says nothing about
// content. The queue is small (a handful of offline writes), so comparing the
// serialised rows is cheap and exact.
function sameEntries(a, b) {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Reactive accessor to the offline mutation queue.
 *
 * Consumers (PendingBadge, SyncStatusBadge, ConflictOrchestrator) subscribe
 * to every queue mutation and always see the current persisted list. Starts
 * empty while the first IndexedDB read is in flight.
 *
 * A read that returns what the hook already holds keeps the previous state,
 * so React skips the render: every routine card carries a SyncStatusBadge,
 * and a queue change unrelated to them must not re-render them all.
 */
export function useQueueEntries() {
  const [entries, setEntries] = useState([])

  useEffect(() => {
    let active = true
    const refresh = async () => {
      const rows = await list()
      if (active) setEntries((prev) => (sameEntries(prev, rows) ? prev : rows))
    }
    refresh()
    const unsubscribe = subscribe(refresh)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return entries
}
