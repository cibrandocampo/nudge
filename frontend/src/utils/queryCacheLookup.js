// Best-effort lookup of a Routine/Stock in TanStack Query's existing
// list caches. Returns the cached object as-is (same shape as the
// detail endpoint serialises, since both use the same DRF serializer)
// or `undefined` when the resource is unknown to any cache.
//
// Used by useRoutine(id) / useStock(id) as the `initialData` source so
// the detail pages render offline whenever the user has previously
// visited a listing that contains the resource. Pure functions over
// the QueryClient — no React, independently unit-testable.

export function findRoutineInCaches(queryClient, id) {
  if (id == null) return undefined
  const numericId = Number(id)
  if (Number.isNaN(numericId)) return undefined

  const dashboard = queryClient.getQueryData(['dashboard'])
  if (dashboard) {
    const all = [...(dashboard.due ?? []), ...(dashboard.upcoming ?? [])]
    const hit = all.find((r) => r?.id === numericId)
    if (hit) return hit
  }
  const list = queryClient.getQueryData(['routines'])
  if (Array.isArray(list)) {
    const hit = list.find((r) => r?.id === numericId)
    if (hit) return hit
  }
  return undefined
}

export function routineSeedUpdatedAt(queryClient) {
  const dash = queryClient.getQueryState(['dashboard'])
  const lst = queryClient.getQueryState(['routines'])
  return Math.max(dash?.dataUpdatedAt ?? 0, lst?.dataUpdatedAt ?? 0)
}

export function findStockInCaches(queryClient, id) {
  if (id == null) return undefined
  const numericId = Number(id)
  if (Number.isNaN(numericId)) return undefined

  const list = queryClient.getQueryData(['stock'])
  if (Array.isArray(list)) {
    const hit = list.find((s) => s?.id === numericId)
    if (hit) return hit
  }
  return undefined
}

export function stockSeedUpdatedAt(queryClient) {
  const lst = queryClient.getQueryState(['stock'])
  return lst?.dataUpdatedAt ?? 0
}
