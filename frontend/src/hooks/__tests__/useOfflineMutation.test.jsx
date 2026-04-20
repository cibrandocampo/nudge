import 'fake-indexeddb/auto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError } from '../../api/errors'
import { mockConflict, mockNetworkError } from '../../test/mocks/handlers'
import { server } from '../../test/mocks/server'
import { clear, list } from '../../offline/queue'
import { useOfflineMutation } from '../useOfflineMutation'

const BASE = 'http://localhost/api'

function renderUseMutation(options) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  return renderHook(() => useOfflineMutation(options), { wrapper })
}

beforeEach(async () => {
  await clear()
  localStorage.setItem('access_token', 'test-token')
})

afterEach(async () => {
  await clear()
  localStorage.clear()
})

describe('useOfflineMutation', () => {
  it('runs the request online and returns the parsed JSON', async () => {
    let keyReceived = null
    server.use(
      http.post(`${BASE}/routines/1/log/`, async ({ request }) => {
        keyReceived = request.headers.get('Idempotency-Key')
        const body = await request.json()
        return HttpResponse.json({ id: 99, notes: body.notes }, { status: 201 })
      }),
    )

    const { result } = renderUseMutation({
      request: ({ routineId, notes }) => ({
        method: 'POST',
        path: `/routines/${routineId}/log/`,
        body: { notes },
      }),
      resourceKey: ({ routineId }) => `routine:${routineId}`,
    })

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({ routineId: 1, notes: 'hi' })
    })

    expect(returned).toEqual({ id: 99, notes: 'hi' })
    expect(keyReceived).toMatch(/^[0-9a-f-]{36}$/i)
    expect(await list()).toHaveLength(0)
  })

  it('enqueues on OfflineError and resolves with {__queued: true}', async () => {
    server.use(mockNetworkError('post', '/routines/1/log/'))

    const { result } = renderUseMutation({
      request: ({ routineId, notes }) => ({
        method: 'POST',
        path: `/routines/${routineId}/log/`,
        body: { notes },
      }),
      resourceKey: ({ routineId }) => `routine:${routineId}`,
    })

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({ routineId: 1, notes: 'bye' })
    })

    expect(returned).toEqual({ __queued: true })
    const queued = await list()
    expect(queued).toHaveLength(1)
    expect(queued[0].method).toBe('POST')
    expect(queued[0].endpoint).toBe('/routines/1/log/')
    expect(queued[0].body).toEqual({ notes: 'bye' })
    expect(queued[0].resourceKey).toBe('routine:1')
    expect(queued[0].status).toBe('pending')
  })

  it('propagates ConflictError to the caller (does not enqueue)', async () => {
    server.use(mockConflict('patch', '/routines/1/', { id: 1, name: 'server' }))

    const onError = vi.fn()
    const { result } = renderUseMutation({
      request: ({ routineId, name }) => ({
        method: 'PATCH',
        path: `/routines/${routineId}/`,
        body: { name },
      }),
      resourceKey: ({ routineId }) => `routine:${routineId}`,
      onError,
    })

    await act(async () => {
      await expect(result.current.mutateAsync({ routineId: 1, name: 'client' })).rejects.toBeInstanceOf(ConflictError)
    })
    await waitFor(() => expect(onError).toHaveBeenCalled())
    expect(await list()).toHaveLength(0)
  })

  it('propagates non-2xx HTTP errors as a plain Error carrying status + body', async () => {
    server.use(http.post(`${BASE}/routines/1/log/`, () => HttpResponse.json({ detail: 'bad' }, { status: 400 })))

    const { result } = renderUseMutation({
      request: ({ routineId }) => ({
        method: 'POST',
        path: `/routines/${routineId}/log/`,
        body: {},
      }),
      resourceKey: 'routine:1',
    })

    let caught = null
    await act(async () => {
      try {
        await result.current.mutateAsync({ routineId: 1 })
      } catch (err) {
        caught = err
      }
    })

    expect(caught).toBeInstanceOf(Error)
    expect(caught.status).toBe(400)
    expect(caught.body).toEqual({ detail: 'bad' })
    expect(await list()).toHaveLength(0)
  })

  it('forwards ifUnmodifiedSince to the api client', async () => {
    let header = 'unset'
    server.use(
      http.patch(`${BASE}/routines/1/`, ({ request }) => {
        header = request.headers.get('If-Unmodified-Since')
        return HttpResponse.json({})
      }),
    )

    const { result } = renderUseMutation({
      request: ({ routineId, updatedAt }) => ({
        method: 'PATCH',
        path: `/routines/${routineId}/`,
        body: { name: 'x' },
        ifUnmodifiedSince: updatedAt,
      }),
      resourceKey: 'routine:1',
    })

    await act(async () => {
      await result.current.mutateAsync({ routineId: 1, updatedAt: '2026-04-17T10:00:00Z' })
    })

    expect(header).toBe(new Date('2026-04-17T10:00:00Z').toUTCString())
  })

  it('returns null for 204 No Content responses', async () => {
    server.use(http.delete(`${BASE}/routines/1/`, () => new HttpResponse(null, { status: 204 })))

    const { result } = renderUseMutation({
      request: ({ routineId }) => ({
        method: 'DELETE',
        path: `/routines/${routineId}/`,
      }),
      resourceKey: 'routine:1',
    })

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({ routineId: 1 })
    })
    expect(returned).toBeNull()
  })

  it('handles GET requests in the request descriptor', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ id: 1 })))

    const { result } = renderUseMutation({
      request: ({ routineId }) => ({
        method: 'GET',
        path: `/routines/${routineId}/`,
      }),
      resourceKey: 'routine:1',
    })

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({ routineId: 1 })
    })
    expect(returned).toEqual({ id: 1 })
  })

  it('enqueue accepts a static string resourceKey and defaults for optional fields', async () => {
    server.use(mockNetworkError('post', '/routines/1/log/'))

    const { result } = renderUseMutation({
      request: () => ({ method: 'POST', path: '/routines/1/log/' }),
      resourceKey: 'routine:static',
    })

    await act(async () => {
      await result.current.mutateAsync({})
    })

    const [entry] = await list()
    expect(entry.resourceKey).toBe('routine:static')
    expect(entry.body).toBeNull()
    expect(entry.ifUnmodifiedSince).toBeNull()
  })

  it('enqueue tolerates a missing resourceKey option', async () => {
    server.use(mockNetworkError('post', '/routines/1/log/'))

    const { result } = renderUseMutation({
      request: () => ({ method: 'POST', path: '/routines/1/log/' }),
      // no resourceKey
    })

    await act(async () => {
      await result.current.mutateAsync({})
    })

    const [entry] = await list()
    expect(entry.resourceKey).toBeNull()
  })

  it('uses parseResponse override when provided', async () => {
    server.use(http.post(`${BASE}/routines/1/log/`, () => HttpResponse.json({ id: 7 }, { status: 201 })))

    const { result } = renderUseMutation({
      request: () => ({ method: 'POST', path: `/routines/1/log/`, body: {} }),
      resourceKey: 'routine:1',
      parseResponse: async (res, vars) => ({ raw: await res.json(), echoed: vars }),
    })

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({ x: 'y' })
    })

    expect(returned).toEqual({ raw: { id: 7 }, echoed: { x: 'y' } })
  })

  // ── queueable flag ────────────────────────────────────────────────────────
  it('queueable: false re-throws OfflineError instead of enqueueing', async () => {
    server.use(mockNetworkError('post', '/auth/change-password/'))

    const { result } = renderUseMutation({
      request: () => ({ method: 'POST', path: '/auth/change-password/', body: {} }),
      resourceKey: 'me:password',
      queueable: false,
    })

    let caught = null
    await act(async () => {
      try {
        await result.current.mutateAsync({})
      } catch (err) {
        caught = err
      }
    })

    expect(caught).toBeInstanceOf(Error)
    expect(caught.name).toBe('OfflineError')
    expect(await list()).toHaveLength(0)
  })

  // ── optimistic helper ─────────────────────────────────────────────────────
  it('optimistic updates the cache before the request and commits on success', async () => {
    server.use(
      http.patch(`${BASE}/routines/1/`, async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({ id: 1, name: body.name })
      }),
    )

    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    qc.setQueryData(['routine', 1], { id: 1, name: 'original' })
    const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>

    const { result } = renderHook(
      () =>
        useOfflineMutation({
          request: ({ name }) => ({ method: 'PATCH', path: '/routines/1/', body: { name } }),
          resourceKey: 'routine:1',
          optimistic: (client, { name }) => {
            const prev = client.getQueryData(['routine', 1])
            client.setQueryData(['routine', 1], { ...prev, name })
            return () => client.setQueryData(['routine', 1], prev)
          },
        }),
      { wrapper },
    )

    await act(async () => {
      await result.current.mutateAsync({ name: 'updated' })
    })

    expect(qc.getQueryData(['routine', 1])).toEqual({ id: 1, name: 'updated' })
  })

  it('optimistic rollback runs on non-offline error (4xx / server error)', async () => {
    server.use(http.patch(`${BASE}/routines/1/`, () => new HttpResponse(null, { status: 400 })))

    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    qc.setQueryData(['routine', 1], { id: 1, name: 'original' })
    const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>

    const { result } = renderHook(
      () =>
        useOfflineMutation({
          request: ({ name }) => ({ method: 'PATCH', path: '/routines/1/', body: { name } }),
          resourceKey: 'routine:1',
          optimistic: (client, { name }) => {
            const prev = client.getQueryData(['routine', 1])
            client.setQueryData(['routine', 1], { ...prev, name })
            return () => client.setQueryData(['routine', 1], prev)
          },
        }),
      { wrapper },
    )

    await act(async () => {
      try {
        await result.current.mutateAsync({ name: 'updated' })
      } catch {
        // expected
      }
    })

    expect(qc.getQueryData(['routine', 1])).toEqual({ id: 1, name: 'original' })
  })

  it('optimistic rollback does NOT run when mutation is queued (offline + queueable)', async () => {
    server.use(mockNetworkError('patch', '/routines/1/'))

    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    qc.setQueryData(['routine', 1], { id: 1, name: 'original' })
    const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>

    const { result } = renderHook(
      () =>
        useOfflineMutation({
          request: ({ name }) => ({ method: 'PATCH', path: '/routines/1/', body: { name } }),
          resourceKey: 'routine:1',
          optimistic: (client, { name }) => {
            const prev = client.getQueryData(['routine', 1])
            client.setQueryData(['routine', 1], { ...prev, name })
            return () => client.setQueryData(['routine', 1], prev)
          },
        }),
      { wrapper },
    )

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({ name: 'updated' })
    })

    expect(returned).toEqual({ __queued: true })
    // Optimistic value stays — the queue will sync it later.
    expect(qc.getQueryData(['routine', 1])).toEqual({ id: 1, name: 'updated' })
  })

  it('optimistic rollback DOES run when mutation is offline + queueable:false', async () => {
    server.use(mockNetworkError('post', '/auth/change-password/'))

    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    qc.setQueryData(['me'], { id: 1, settings_updated_at: 'old' })
    const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>

    const { result } = renderHook(
      () =>
        useOfflineMutation({
          request: () => ({ method: 'POST', path: '/auth/change-password/', body: {} }),
          resourceKey: 'me:password',
          queueable: false,
          optimistic: (client) => {
            const prev = client.getQueryData(['me'])
            client.setQueryData(['me'], { ...prev, settings_updated_at: 'new' })
            return () => client.setQueryData(['me'], prev)
          },
        }),
      { wrapper },
    )

    await act(async () => {
      try {
        await result.current.mutateAsync({})
      } catch {
        // expected
      }
    })

    expect(qc.getQueryData(['me'])).toEqual({ id: 1, settings_updated_at: 'old' })
  })

  // ── caller chaining ───────────────────────────────────────────────────────
  it("chains caller's onMutate / onError / onSuccess with the user context preserved", async () => {
    server.use(http.post(`${BASE}/routines/1/log/`, () => HttpResponse.json({ ok: true }, { status: 201 })))

    const onMutate = vi.fn(() => ({ startedAt: 42 }))
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const onSettled = vi.fn()

    const { result } = renderUseMutation({
      request: () => ({ method: 'POST', path: '/routines/1/log/', body: {} }),
      resourceKey: 'routine:1',
      onMutate,
      onSuccess,
      onError,
      onSettled,
    })

    await act(async () => {
      await result.current.mutateAsync({ routineId: 1 })
    })

    expect(onMutate).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    // Third argument is the user context — not the wrapper's internal one.
    expect(onSuccess.mock.calls[0][2]).toEqual({ startedAt: 42 })
    expect(onError).not.toHaveBeenCalled()
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(onSettled.mock.calls[0][3]).toEqual({ startedAt: 42 })
  })
})
