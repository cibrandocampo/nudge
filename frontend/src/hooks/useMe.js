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

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => getJson('/auth/me/'),
  })
}
