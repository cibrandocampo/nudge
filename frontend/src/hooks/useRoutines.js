import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { findRoutineInCaches, routineSeedUpdatedAt } from '../utils/queryCacheLookup'

async function getJson(path) {
  const res = await api.get(path)
  if (!res.ok) {
    const err = new Error(`GET ${path} failed`)
    err.status = res.status
    throw err
  }
  return res.json()
}

export function useRoutines() {
  return useQuery({
    queryKey: ['routines'],
    queryFn: async () => {
      const data = await getJson('/routines/')
      return data.results ?? data
    },
  })
}

export function useRoutine(id) {
  // Seed from existing list caches (`['dashboard']`, `['routines']`) when
  // available so the detail page renders immediately offline. Online,
  // queryFn refetches in the background and replaces the seed with the
  // canonical detail data. Without the seed timestamp TanStack Query
  // would treat the seed as "freshly fetched" and skip the refetch.
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: ['routine', Number(id)],
    queryFn: () => getJson(`/routines/${id}/`),
    enabled: id !== undefined && id !== null,
    initialData: () => findRoutineInCaches(queryClient, id),
    initialDataUpdatedAt: () => routineSeedUpdatedAt(queryClient),
  })
}

export function useRoutineEntries(id, limit = 5) {
  return useQuery({
    queryKey: ['routine-entries', Number(id), limit],
    queryFn: async () => {
      const data = await getJson(`/routines/${id}/entries/`)
      const rows = data.results ?? data
      return rows.slice(0, limit)
    },
    enabled: id !== undefined && id !== null,
  })
}
