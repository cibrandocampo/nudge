import { useEffect, useState } from 'react'
import { list, subscribe } from '../offline/queue'

/**
 * Reactive accessor to the offline mutation queue.
 *
 * Consumers (PendingBadge, SyncStatusBadge, ConflictOrchestrator) subscribe
 * to every queue mutation and always see the current persisted list.
 *
 * `initial` lets callers seed the hook synchronously (useful for tests and
 * for rendering default empty state while the first IndexedDB read is in
 * flight).
 */
export function useQueueEntries() {
  const [entries, setEntries] = useState([])

  useEffect(() => {
    let active = true
    const refresh = async () => {
      const rows = await list()
      if (active) setEntries(rows)
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
