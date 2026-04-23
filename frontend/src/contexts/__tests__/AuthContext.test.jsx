import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, act, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../test/mocks/server'
import { AuthProvider, useAuth } from '../AuthContext'

const BASE = 'http://localhost/api'

function createWrapper(qc) {
  return function Wrapper({ children }) {
    return (
      <QueryClientProvider client={qc}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    )
  }
}

describe('AuthContext', () => {
  let qc
  let wrapper

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    wrapper = createWrapper(qc)
  })

  it('resolves to user=null and loading=false when no token', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
  })

  it('fetches user when token is in localStorage', async () => {
    localStorage.setItem('access_token', 'tok')
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toEqual(expect.objectContaining({ username: 'testuser' }))
  })

  it('remains user=null when fetch fails on mount', async () => {
    localStorage.setItem('access_token', 'tok')
    server.use(http.get(`${BASE}/auth/me/`, () => HttpResponse.error()))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
  })

  it('hydrates user from cache when /auth/me/ fails offline and token is valid', async () => {
    // Simulates reopening the PWA while the backend is unreachable: the
    // persister has already re-hydrated ['me'], so ProtectedRoute must not
    // redirect to /login. `useQuery.data` retains the pre-seeded value
    // even after `queryFn` rejects.
    localStorage.setItem('access_token', 'tok')
    qc.setQueryData(['me'], { id: 1, username: 'cached-user' })
    server.use(http.get(`${BASE}/auth/me/`, () => HttpResponse.error()))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user).toEqual({ id: 1, username: 'cached-user' }))
  })

  it('stays user=null when offline and no cached me is available', async () => {
    // Fresh install or evicted cache: no snapshot to hydrate from; the
    // ProtectedRoute redirect to /login is the correct behaviour here.
    localStorage.setItem('access_token', 'tok')
    server.use(http.get(`${BASE}/auth/me/`, () => HttpResponse.error()))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
  })

  it('login sets tokens and fetches user', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.login('testuser', 'pass')
    })

    expect(localStorage.getItem('access_token')).toBe('fake-access')
    expect(localStorage.getItem('refresh_token')).toBe('fake-refresh')
    await waitFor(() => expect(result.current.user).toEqual(expect.objectContaining({ username: 'testuser' })))
  })

  it('login throws on invalid credentials', async () => {
    server.use(http.post(`${BASE}/auth/token/`, () => new HttpResponse(null, { status: 401 })))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(
      act(async () => {
        await result.current.login('bad', 'creds')
      }),
    ).rejects.toThrow('Invalid credentials')
  })

  it('logout clears storage and user', async () => {
    localStorage.setItem('access_token', 'tok')
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user).not.toBeNull())

    await act(async () => {
      result.current.logout()
    })

    await waitFor(() => expect(result.current.user).toBeNull())
    expect(localStorage.getItem('access_token')).toBeNull()
  })

  it('useAuth returns context value', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toHaveProperty('login')
    expect(result.current).toHaveProperty('logout')
    expect(result.current).toHaveProperty('user')
    expect(result.current).toHaveProperty('loading')
  })
})
