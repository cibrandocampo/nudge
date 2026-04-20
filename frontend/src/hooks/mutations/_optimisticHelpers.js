/**
 * Tiny utilities shared by the `optimistic` function of each operational
 * mutation hook. The goal is to keep rollback boilerplate consistent and
 * under a handful of lines per hook:
 *
 *   optimistic: (qc, vars) => {
 *     const snap = snapshotKeys(qc, [['dashboard'], ['routine', id]])
 *     qc.setQueryData(['dashboard'], (prev) => ...)
 *     qc.setQueryData(['routine', id], (prev) => ({ ...prev, ...patch }))
 *     return () => restoreKeys(qc, snap)
 *   }
 *
 * `snapshotKeys` takes exact keys — good for `['routine', id]`. For queries
 * that have filters (entries, stock-consumptions), use `snapshotMatching`
 * with a filter; it uses `getQueriesData`, which returns every paginated /
 * filtered variant the consumer has subscribed to.
 */

export function snapshotKeys(queryClient, keys) {
  const entries = []
  for (const key of keys) {
    entries.push([key, queryClient.getQueryData(key)])
  }
  return entries
}

export function restoreKeys(queryClient, snapshot) {
  for (const [key, data] of snapshot) {
    queryClient.setQueryData(key, data)
  }
}

export function snapshotMatching(queryClient, filter) {
  // Clone the pairs so a later `setQueryData` on the same key cannot
  // mutate our snapshot through object identity.
  return queryClient.getQueriesData(filter).map(([key, data]) => [key, data])
}

export function restoreMatching(queryClient, snapshot) {
  for (const [key, data] of snapshot) {
    queryClient.setQueryData(key, data)
  }
}
