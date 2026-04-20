import { useEffect, useState } from 'react'
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

export function useContacts() {
  return useQuery({
    queryKey: ['contacts'],
    queryFn: () => getJson('/auth/contacts/'),
  })
}

export function useContactSearch(query, debounceMs = 300) {
  const [debounced, setDebounced] = useState(query)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), debounceMs)
    return () => clearTimeout(id)
  }, [query, debounceMs])

  return useQuery({
    queryKey: ['contacts-search', debounced],
    queryFn: () => getJson(`/auth/contacts/search/?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
  })
}
