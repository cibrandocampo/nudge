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

export function useStock(id) {
  // Seed from the `['stock']` list cache when available so the detail
  // page renders immediately offline. Online, queryFn refetches in the
  // background. Mirrors the pattern in `useRoutine`.
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: ['stock', Number(id)],
    queryFn: () => getJson(`/stock/${id}/`),
    enabled: id !== undefined && id !== null,
    initialData: () => findStockInCaches(queryClient, id),
    initialDataUpdatedAt: () => stockSeedUpdatedAt(queryClient),
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
