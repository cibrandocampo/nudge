import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

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
  return useQuery({
    queryKey: ['stock', Number(id)],
    queryFn: () => getJson(`/stock/${id}/`),
    enabled: id !== undefined && id !== null,
  })
}

export function useStockLots(stockId) {
  return useQuery({
    queryKey: ['stock-lots', Number(stockId)],
    queryFn: () => getJson(`/stock/${stockId}/lots-for-selection/`),
    enabled: stockId !== undefined && stockId !== null,
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
