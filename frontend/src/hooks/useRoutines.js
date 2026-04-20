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
  return useQuery({
    queryKey: ['routine', Number(id)],
    queryFn: () => getJson(`/routines/${id}/`),
    enabled: id !== undefined && id !== null,
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
