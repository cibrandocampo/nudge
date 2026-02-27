import { renderHook, act, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { AuthProvider, useAuth } from '../AuthContext'

const BASE = 'http://localhost/api'

function wrapper({ children }) {
  return <AuthProvider>{children}</AuthProvider>
}

describe('AuthContext', () => {
  it('starts with loading=true and user=null when no token', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    // After mount it should resolve quickly
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

  it('login sets tokens and fetches user', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.login('testuser', 'pass')
    })

    expect(localStorage.getItem('access_token')).toBe('fake-access')
    expect(localStorage.getItem('refresh_token')).toBe('fake-refresh')
    expect(result.current.user).toEqual(expect.objectContaining({ username: 'testuser' }))
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

    act(() => {
      result.current.logout()
    })

    expect(result.current.user).toBeNull()
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
