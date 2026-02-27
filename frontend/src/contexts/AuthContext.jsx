import { createContext, useContext, useEffect, useState } from 'react'
import { api, BASE_URL } from '../api/client'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem('access_token')))

  useEffect(() => {
    if (!loading) return
    api
      .get('/auth/me/')
      .then((r) => r.json())
      .then(setUser)
      .catch(() => {
        // The api client already handles 401 (clears storage + redirects to /login).
        // For transient errors (network, 500) we leave localStorage intact so the
        // user isn't unexpectedly logged out.
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
