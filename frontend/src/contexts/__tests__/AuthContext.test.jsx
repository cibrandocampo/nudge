import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, act, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../test/mocks/server'
import { mockUser } from '../../test/mocks/handlers'
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

  // ── /auth/me/ rehydration ───────────────────────────────────────────────

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

  it('remains user=null and captures the status when /auth/me/ returns a non-ok response', async () => {
    localStorage.setItem('access_token', 'tok')
    server.use(http.get(`${BASE}/auth/me/`, () => new HttpResponse(null, { status: 401 })))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
    expect(qc.getQueryState(['me']).error).toMatchObject({ status: 401 })
  })

  it('hydrates user from cache when /auth/me/ fails offline and token is valid', async () => {
    localStorage.setItem('access_token', 'tok')
    qc.setQueryData(['me'], { id: 1, username: 'cached-user', email: 'c@x.com' })
    server.use(http.get(`${BASE}/auth/me/`, () => HttpResponse.error()))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user).toEqual({ id: 1, username: 'cached-user', email: 'c@x.com' }))
  })

  it('stays user=null when offline and no cached me is available', async () => {
    localStorage.setItem('access_token', 'tok')
    server.use(http.get(`${BASE}/auth/me/`, () => HttpResponse.error()))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
  })

  // ── allowSelfSignup (public auth config) ────────────────────────────────

  it('starts allowSelfSignup=null and resolves to the value returned by /auth/config/', async () => {
    server.use(http.get(`${BASE}/auth/config/`, () => HttpResponse.json({ allow_self_signup: true })))
    const { result } = renderHook(() => useAuth(), { wrapper })
    // Null until the first fetch resolves — callers rely on this to
    // render no copy at all while loading.
    expect(result.current.allowSelfSignup).toBeNull()
    await waitFor(() => expect(result.current.allowSelfSignup).toBe(true))
  })

  it('exposes allowSelfSignup=false when the server reports signup disabled', async () => {
    server.use(http.get(`${BASE}/auth/config/`, () => HttpResponse.json({ allow_self_signup: false })))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.allowSelfSignup).toBe(false))
  })

  it('keeps allowSelfSignup=null when /auth/config/ fails', async () => {
    server.use(http.get(`${BASE}/auth/config/`, () => HttpResponse.error()))
    const { result } = renderHook(() => useAuth(), { wrapper })
    // Wait one frame to let the query settle.
    await waitFor(() => expect(qc.getQueryState(['auth-config']).status).toBe('error'))
    expect(result.current.allowSelfSignup).toBeNull()
  })

  // ── loginStart ──────────────────────────────────────────────────────────

  it('loginStart returns the method on a 200 response', async () => {
    server.use(http.post(`${BASE}/auth/login/start/`, () => HttpResponse.json({ method: 'otp' })))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    let res
    await act(async () => {
      res = await result.current.loginStart('x@y.z')
    })
    expect(res).toEqual({ method: 'otp' })
    // start must NOT touch tokens
    expect(localStorage.getItem('access_token')).toBeNull()
  })

  it('loginStart rejects with user_not_found on 404', async () => {
    server.use(http.post(`${BASE}/auth/login/start/`, () => new HttpResponse(null, { status: 404 })))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(
      act(async () => {
        await result.current.loginStart('ghost@y.z')
      }),
    ).rejects.toThrow('user_not_found')
  })

  it('loginStart rejects with login_start_failed on other non-2xx', async () => {
    server.use(http.post(`${BASE}/auth/login/start/`, () => new HttpResponse(null, { status: 429 })))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(
      act(async () => {
        await result.current.loginStart('x@y.z')
      }),
    ).rejects.toThrow('login_start_failed')
  })

  // ── loginVerify ─────────────────────────────────────────────────────────

  it('loginVerify writes tokens, caches me, and returns is_new', async () => {
    server.use(
      http.post(`${BASE}/auth/login/verify/`, () =>
        HttpResponse.json({ access: 'a-tok', refresh: 'r-tok', is_new: true }),
      ),
    )
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    let res
    await act(async () => {
      res = await result.current.loginVerify('x@y.z', { code: '123456' })
    })
    expect(res).toEqual({ is_new: true })
    expect(localStorage.getItem('access_token')).toBe('a-tok')
    expect(localStorage.getItem('refresh_token')).toBe('r-tok')
    await waitFor(() => expect(qc.getQueryData(['me'])).toEqual(expect.objectContaining({ email: mockUser.email })))
  })

  it('loginVerify rejects with login_verify_failed on non-2xx', async () => {
    server.use(http.post(`${BASE}/auth/login/verify/`, () => new HttpResponse(null, { status: 400 })))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    let caught
    await act(async () => {
      try {
        await result.current.loginVerify('x@y.z', { code: 'bad' })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Error)
    expect(caught.message).toBe('login_verify_failed')
    expect(caught.status).toBe(400)
    expect(localStorage.getItem('access_token')).toBeNull()
  })

  // ── completeProfile ─────────────────────────────────────────────────────

  it('completeProfile patches /auth/me/ and refreshes the cache', async () => {
    localStorage.setItem('access_token', 'tok')
    const updated = { ...mockUser, first_name: 'Ada', last_name: 'Lovelace' }
    let patchedBody = null
    server.use(
      http.patch(`${BASE}/auth/me/`, async ({ request }) => {
        patchedBody = await request.json()
        return HttpResponse.json(updated)
      }),
    )

    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.completeProfile('Ada', 'Lovelace')
    })
    expect(patchedBody).toEqual({ first_name: 'Ada', last_name: 'Lovelace' })
    expect(qc.getQueryData(['me'])).toEqual(updated)
  })

  // ── isNewUser derived flag ──────────────────────────────────────────────

  it('isNewUser is false when first/last name are set', async () => {
    localStorage.setItem('access_token', 'tok')
    server.use(
      http.get(`${BASE}/auth/me/`, () => HttpResponse.json({ ...mockUser, first_name: 'Ada', last_name: 'Lovelace' })),
    )
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user).not.toBeNull())
    expect(result.current.isNewUser).toBe(false)
  })

  it('isNewUser is true when first AND last name are absent', async () => {
    // mockUser ships without first_name/last_name — the canonical "fresh
    // signup" shape post-T193.
    localStorage.setItem('access_token', 'tok')
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user).not.toBeNull())
    expect(result.current.isNewUser).toBe(true)
  })

  it('isNewUser is false when only one of first/last is set', async () => {
    localStorage.setItem('access_token', 'tok')
    server.use(
      http.get(`${BASE}/auth/me/`, () => HttpResponse.json({ ...mockUser, first_name: 'Solo', last_name: '' })),
    )
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user).not.toBeNull())
    expect(result.current.isNewUser).toBe(false)
  })

  // ── logout ──────────────────────────────────────────────────────────────

  it('logout clears storage and user', async () => {
    localStorage.setItem('access_token', 'tok')
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user).not.toBeNull())

    await act(async () => {
      result.current.logout()
    })

    await waitFor(() => expect(result.current.user).toBeNull())
    expect(localStorage.getItem('access_token')).toBeNull()
    expect(localStorage.getItem('refresh_token')).toBeNull()
  })

  // ── public API shape ────────────────────────────────────────────────────

  it('useAuth exposes the new context shape', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toEqual(
      expect.objectContaining({
        user: null,
        loading: false,
        isNewUser: false,
        loginStart: expect.any(Function),
        loginVerify: expect.any(Function),
        completeProfile: expect.any(Function),
        logout: expect.any(Function),
      }),
    )
    // Old `login(username, password)` is intentionally gone.
    expect(result.current).not.toHaveProperty('login')
  })
})
