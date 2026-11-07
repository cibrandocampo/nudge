import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { persistQueryClientSubscribe } from '@tanstack/react-query-persist-client'
import { renderHook, act, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enqueue, list } from '../../offline/queue'
import { persister } from '../../query/queryClient'
import { server } from '../../test/mocks/server'
import { mockUser } from '../../test/mocks/handlers'
import { AuthProvider, useAuth } from '../AuthContext'

const BASE = 'http://localhost/api'

// A queued offline write. The global setup empties the queue before each test.
const queueEntry = (id) => ({
  id,
  method: 'POST',
  endpoint: '/routines/5/log/',
  body: {},
  resourceKey: 'routine:5',
  createdAt: '2026-11-05T08:00:00Z',
  status: 'pending',
})

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

  it('keeps allowSelfSignup=null when /auth/config/ returns a non-ok status', async () => {
    // Distinct from the network-error case above: here the fetch
    // resolves but the server replied 5xx. Exercises the `!res.ok`
    // branch inside the queryFn that wraps the error with `err.status`.
    server.use(http.get(`${BASE}/auth/config/`, () => new HttpResponse(null, { status: 500 })))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(qc.getQueryState(['auth-config']).status).toBe('error'))
    expect(result.current.allowSelfSignup).toBeNull()
    expect(qc.getQueryState(['auth-config']).error).toMatchObject({
      message: 'auth_config_failed',
      status: 500,
    })
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

  it('loginStart rejects with disposable_email on 400 with that body', async () => {
    server.use(
      http.post(`${BASE}/auth/login/start/`, () => HttpResponse.json({ error: 'disposable_email' }, { status: 400 })),
    )
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(
      act(async () => {
        await result.current.loginStart('x@yopmail.com')
      }),
    ).rejects.toThrow('disposable_email')
  })

  it('loginStart rejects with status=400 when 400 carries a different error body', async () => {
    // Covers the fall-through after the `disposable_email` short-circuit:
    // a 400 with any other shape gets wrapped as login_start_failed +
    // status=400 so the caller can branch on the status field.
    server.use(
      http.post(`${BASE}/auth/login/start/`, () => HttpResponse.json({ error: 'something_else' }, { status: 400 })),
    )
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    let caught
    await act(async () => {
      try {
        await result.current.loginStart('x@y.z')
      } catch (e) {
        caught = e
      }
    })
    expect(caught?.message).toBe('login_start_failed')
    expect(caught?.status).toBe(400)
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

  it('completeProfile rejects with complete_profile_failed and keeps the cached user on a non-2xx', async () => {
    localStorage.setItem('access_token', 'tok')
    server.use(http.patch(`${BASE}/auth/me/`, () => new HttpResponse(null, { status: 400 })))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user).not.toBeNull())
    const before = qc.getQueryData(['me'])

    await act(async () => {
      await expect(result.current.completeProfile('Ada', 'Lovelace')).rejects.toThrow('complete_profile_failed')
    })
    expect(qc.getQueryData(['me'])).toEqual(before)
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
      await result.current.logout()
    })

    await waitFor(() => expect(result.current.user).toBeNull())
    expect(localStorage.getItem('access_token')).toBeNull()
    expect(localStorage.getItem('refresh_token')).toBeNull()
  })

  it('logout empties the offline queue', async () => {
    localStorage.setItem('access_token', 'tok')
    await enqueue(queueEntry('k-1'))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user).not.toBeNull())

    await act(async () => {
      await result.current.logout()
    })

    expect(await list()).toEqual([])
  })

  it('logout leaves no snapshot of the user in the persisted cache', async () => {
    localStorage.setItem('access_token', 'tok')
    // The app persists through PersistQueryClientProvider; subscribe the
    // same persister to this client so its writes happen here. The
    // persister throttles writes to one per second (a library default the
    // app keeps), so each wait below spans two intervals: one write may
    // have just run, and the next waits a full interval behind it.
    const THROTTLE_MS = 1000
    const unsubscribe = persistQueryClientSubscribe({ queryClient: qc, persister })
    try {
      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.user).not.toBeNull())
      qc.setQueryData(['routines'], [{ id: 7, name: 'Private routine' }])
      await waitFor(async () => expect(JSON.stringify(await persister.restoreClient())).toContain('Private routine'), {
        timeout: 2 * THROTTLE_MS,
      })

      await act(async () => {
        await result.current.logout()
        // A write scheduled during logout lands within the window; read
        // the snapshot only after it.
        await new Promise((resolve) => setTimeout(resolve, 2 * THROTTLE_MS))
      })

      const snapshot = await persister.restoreClient()
      const queries = snapshot?.clientState.queries ?? []
      expect(queries.map((q) => q.queryKey)).not.toContainEqual(['routines'])
      expect(queries.find((q) => q.queryKey[0] === 'me')?.state.data ?? null).toBeNull()
    } finally {
      unsubscribe()
      await persister.removeClient()
    }
  })

  it('logout unregisters the push subscription while still authenticated', async () => {
    localStorage.setItem('access_token', 'tok')
    const subscription = { endpoint: 'https://push.example.com/sub/9', unsubscribe: vi.fn().mockResolvedValue(true) }
    const { pushManager } = await navigator.serviceWorker.ready
    pushManager.getSubscription.mockResolvedValueOnce(subscription)
    const unsubscribeCalls = []
    server.use(
      http.delete(`${BASE}/push/unsubscribe/`, async ({ request }) => {
        unsubscribeCalls.push({ auth: request.headers.get('Authorization'), body: await request.json() })
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user).not.toBeNull())

    await act(async () => {
      await result.current.logout()
    })

    expect(unsubscribeCalls).toEqual([{ auth: 'Bearer tok', body: { endpoint: 'https://push.example.com/sub/9' } }])
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('logout still signs out when unregistering push fails', async () => {
    localStorage.setItem('access_token', 'tok')
    const { pushManager } = await navigator.serviceWorker.ready
    pushManager.getSubscription.mockResolvedValueOnce({
      endpoint: 'https://push.example.com/sub/9',
      unsubscribe: vi.fn(),
    })
    server.use(http.delete(`${BASE}/push/unsubscribe/`, () => new HttpResponse(null, { status: 500 })))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user).not.toBeNull())

    await act(async () => {
      await result.current.logout()
    })

    expect(result.current.user).toBeNull()
    expect(localStorage.getItem('access_token')).toBeNull()
  })

  it('pendingChangesCount reads the number of queued offline writes', async () => {
    await enqueue(queueEntry('k-1'))
    await enqueue(queueEntry('k-2'))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(result.current.pendingChangesCount()).resolves.toBe(2)
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
        pendingChangesCount: expect.any(Function),
      }),
    )
    // Old `login(username, password)` is intentionally gone.
    expect(result.current).not.toHaveProperty('login')
  })
})
