import { createContext, useContext } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, BASE_URL } from '../api/client'
import { clear as clearQueue, list as listQueue } from '../offline/queue'
import { persister } from '../query/queryClient'
import { unsubscribeFromPush } from '../utils/push'

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

  // Public, unauthenticated server-side feature flags. Currently just
  // `allow_self_signup`, used by /login to switch between "Sign in" and
  // "Sign in or register" copy. Inherits the global `staleTime: 30_000`
  // (see query/queryClient.js): the persisted snapshot in IndexedDB is
  // always older than 30 s on a fresh page load, so the query refetches
  // and picks up server-side flips after a restart without needing to
  // clear the cache by hand.
  const configQuery = useQuery({
    queryKey: ['auth-config'],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/auth/config/`)
      if (!res.ok) {
        const err = new Error('auth_config_failed')
        err.status = res.status
        throw err
      }
      return res.json()
    },
  })
  // `null` until the first fetch resolves so callers can render no
  // copy at all while loading instead of flickering between the two
  // alternatives.
  const allowSelfSignup = configQuery.data?.allow_self_signup ?? null

  // `data` survives a failed refetch when the persister rehydrated it
  // from IndexedDB, so reopening the PWA offline still exposes the last
  // known user without a /login redirect.
  const user = query.data ?? null
  const loading = hasToken && query.isPending
  // Derived from the canonical `me` payload. Frontend gates the
  // onboarding step on this; backend never persists a separate
  // `is_new` flag (the verify endpoint returns it as a convenience).
  const isNewUser = Boolean(user) && !user.first_name && !user.last_name

  // Step 1 of the email-OTP flow. Returns `{ method: 'otp' | 'password' }`.
  // Throws `Error('user_not_found')` on 404 (self-signup disabled), or
  // `Error('disposable_email')` when self-signup tried to register from a
  // throwaway provider (yopmail, mailinator, …).
  const loginStart = async (email) => {
    const res = await fetch(`${BASE_URL}/auth/login/start/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (res.status === 404) throw new Error('user_not_found')
    if (res.status === 400) {
      const body = await res.json().catch(() => ({}))
      if (body?.error === 'disposable_email') throw new Error('disposable_email')
      const err = new Error('login_start_failed')
      err.status = 400
      throw err
    }
    if (!res.ok) {
      const err = new Error('login_start_failed')
      err.status = res.status
      throw err
    }
    return res.json()
  }

  // Step 2. `payload` is either `{ code }` (OTP user) or `{ password }`
  // (password user). On success persists tokens, primes the `me` cache,
  // and resolves with `{ is_new }` so the caller can route to the
  // onboarding step when appropriate.
  const loginVerify = async (email, payload) => {
    const res = await fetch(`${BASE_URL}/auth/login/verify/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, ...payload }),
    })
    if (!res.ok) {
      const err = new Error('login_verify_failed')
      err.status = res.status
      throw err
    }
    const { access, refresh, is_new } = await res.json()
    localStorage.setItem('access_token', access)
    localStorage.setItem('refresh_token', refresh)
    const me = await api.get('/auth/me/').then((r) => r.json())
    queryClient.setQueryData(['me'], me)
    return { is_new }
  }

  // Onboarding step. PATCHes /auth/me/ with first/last name and
  // refreshes the cache so `isNewUser` flips to false immediately.
  const completeProfile = async (first_name, last_name) => {
    const res = await api.patch('/auth/me/', { first_name, last_name })
    if (!res.ok) throw new Error('complete_profile_failed')
    const updated = await res.json()
    queryClient.setQueryData(['me'], updated)
  }

  // How many offline writes would be lost by signing out now. Read from the
  // queue at the moment of asking, never from a cached count.
  const pendingChangesCount = async () => (await listQueue()).length

  // Leaves the device without the user's data: tokens, offline queue, and
  // the query cache both in memory and in IndexedDB. Device preferences
  // (scanner camera, collapsed inventory groups) live in localStorage under
  // their own keys and stay. Callers navigate to /login afterwards.
  const logout = async () => {
    // Still authenticated: the backend call needs the token.
    await unsubscribeFromPush().catch(() => {})
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    // Null before any cache removal, so the active observer sees user=null
    // this render while its query still exists. Removing the query first
    // (clear / removeQueries) would leave the observer on a destroyed Query
    // that never reports the change, and — because the re-render that flips
    // `enabled` to false hasn't run yet — a fresh one would refetch the old
    // session.
    queryClient.setQueryData(['me'], null)
    // Otherwise the next user on this device would replay these writes
    // with their own token.
    await clearQueue()
    // Memory first, then the persisted snapshot: the persister writes on
    // every cache change, so removing the snapshot before clearing would
    // let that write bring it back with the old data. A throttled write
    // can still land afterwards, but it carries the cleared cache.
    queryClient.clear()
    await persister.removeClient()
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isNewUser,
        allowSelfSignup,
        loginStart,
        loginVerify,
        completeProfile,
        logout,
        pendingChangesCount,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
