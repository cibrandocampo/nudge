import { createContext, useContext, useEffect, useState } from 'react'
import { api, BASE_URL } from '../api/client'
import { OfflineError } from '../api/errors'
import { queryClient } from '../query/queryClient'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem('access_token')))

  useEffect(() => {
    if (!loading) return
    api
      .get('/auth/me/')
      .then((r) => r.json())
      .then((me) => {
        // Persist `me` in the TQ cache so the offline hydration path
        // below has something to read after an offline reload. The
        // persister writes it to IDB automatically on the next flush.
        queryClient.setQueryData(['me'], me)
        setUser(me)
      })
      .catch((err) => {
        // The api client already handles 401 (clears storage + redirects to /login).
        // For transient errors (non-network 5xx) we leave localStorage intact so the
        // user isn't unexpectedly logged out.
        //
        // Offline + valid token: hydrate `user` from the persisted TanStack
        // Query cache of `['me']` so ProtectedRoute doesn't redirect to
        // /login on every reload when there's no network. Without this the
        // PWA is unusable offline even when the full cache was written on
        // a previous online session.
        if (err instanceof OfflineError && localStorage.getItem('access_token')) {
          const cached = queryClient.getQueryData(['me'])
          if (cached) setUser(cached)
        }
      })
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    setUser(me)
  }

  const logout = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, login, logout, loading }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
