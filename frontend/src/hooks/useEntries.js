import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
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

function entriesQueryString(filters, page) {
  const params = new URLSearchParams({ page: String(page) })
  if (filters?.routine) params.set('routine', filters.routine)
  if (filters?.dateFrom) params.set('date_from', filters.dateFrom)
  if (filters?.dateTo) params.set('date_to', filters.dateTo)
  return params.toString()
}

export function useEntries(filters = {}) {
  return useInfiniteQuery({
    queryKey: ['entries', filters],
    queryFn: async ({ pageParam }) => {
      const data = await getJson(`/entries/?${entriesQueryString(filters, pageParam)}`)
      return {
        items: data.results ?? data,
        next: data.next ?? null,
        page: pageParam,
      }
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.next ? lastPage.page + 1 : undefined),
    enabled: filters?.enabled !== false,
  })
}

export function useStockConsumptions(filters = {}) {
  return useQuery({
    queryKey: ['stock-consumptions', filters],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters.stock) params.set('stock', filters.stock)
      if (filters.dateFrom) params.set('date_from', filters.dateFrom)
      if (filters.dateTo) params.set('date_to', filters.dateTo)
      const qs = params.toString()
      const data = await getJson(`/stock-consumptions/${qs ? `?${qs}` : ''}`)
      return data.results ?? data
    },
    enabled: filters?.enabled !== false,
  })
}
