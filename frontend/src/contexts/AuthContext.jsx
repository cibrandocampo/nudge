import { createContext, useContext } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, BASE_URL } from '../api/client'

export const AuthContext = createContext(null)

// Source of truth for the authenticated user. Reads from the TanStack
// Query cache key ['me']; any mutation that writes or invalidates that
// key is automatically reflected here — do not recreate a standalone
// `useMe` hook.
export function AuthProvider({ children }) {
  const queryClient = useQueryClient()
  const hasToken = Boolean(localStorage.getItem('access_token'))

  const query = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await api.get('/auth/me/')
      if (!res.ok) {
        const err = new Error(`GET /auth/me/ failed (${res.status})`)
        err.status = res.status
        throw err
      }
      return res.json()
    },
    enabled: hasToken,
  })

  // `data` survives a failed refetch when the persister rehydrated it
  // from IndexedDB, so reopening the PWA offline still exposes the last
  // known user without a /login redirect.
  const user = query.data ?? null
  const loading = hasToken && query.isPending

  const login = async (username, password) => {
    const res = await fetch(`${BASE_URL}/auth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) throw new Error('Invalid credentials')

    const { access, refresh } = await res.json()
    localStorage.setItem('access_token', access)
    localStorage.setItem('refresh_token', refresh)

    const me = await api.get('/auth/me/').then((r) => r.json())
    queryClient.setQueryData(['me'], me)
  }

  const logout = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    // Null (not removeQueries) so the active observer sees user=null this
    // render. removeQueries would transition the observer to a fresh
    // Query and — because the re-render that flips `enabled` to false
    // hasn't run yet — trigger an unwanted refetch of the old session.
    queryClient.setQueryData(['me'], null)
  }

  return <AuthContext.Provider value={{ user, login, logout, loading }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
