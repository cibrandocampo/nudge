import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'

// The api client updates `reachability.setReachable(…)` after every fetch.
// That module pulls in the sync worker (which boots window listeners and
// IDB access), so mock sync before importing client to keep the suite
// hermetic.
vi.mock('../../offline/sync', () => ({ forceSync: vi.fn() }))

import { __resetForTests, getReachable } from '../../offline/reachability'
import { mockConflict, mockNetworkError } from '../../test/mocks/handlers'
import { server } from '../../test/mocks/server'
import { api } from '../client'
import { ConflictError, OfflineError } from '../errors'

const BASE = 'http://localhost/api'

const UUIDV4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('api client', () => {
  beforeEach(() => {
    localStorage.setItem('access_token', 'test-access')
    localStorage.setItem('refresh_token', 'test-refresh')
    // Prevent actual location redirects
    delete window.location
    window.location = { href: '' }
  })

  afterEach(() => {
    window.location = globalThis.location
    // Reset reachability so a prior test that flipped it to `false` does
    // not leak its health-check timer into the next one.
    __resetForTests()
  })

  it('GET sends auth header', async () => {
    const res = await api.get('/auth/me/')
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.username).toBe('testuser')
  })

  it('GET without token sends no auth header', async () => {
    localStorage.clear()
    server.use(
      http.get(`${BASE}/auth/me/`, ({ request }) => {
        const auth = request.headers.get('Authorization')
        return HttpResponse.json({ noAuth: !auth })
      }),
    )
    const res = await api.get('/auth/me/')
    const data = await res.json()
    expect(data.noAuth).toBe(true)
  })

  it('POST sends body as JSON', async () => {
    server.use(
      http.post(`${BASE}/routines/`, async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({ received: body.name }, { status: 201 })
      }),
    )
    const res = await api.post('/routines/', { name: 'Test' })
    const data = await res.json()
    expect(data.received).toBe('Test')
  })

  it('PATCH sends body as JSON', async () => {
    server.use(
      http.patch(`${BASE}/routines/1/`, async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({ updated: body.name })
      }),
    )
    const res = await api.patch('/routines/1/', { name: 'Updated' })
    const data = await res.json()
    expect(data.updated).toBe('Updated')
  })

  it('DELETE works without body', async () => {
    const res = await api.delete('/routines/1/')
    expect(res.status).toBe(204)
  })

  it('DELETE can send body', async () => {
    server.use(
      http.delete(`${BASE}/push/unsubscribe/`, async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({ endpoint: body.endpoint })
      }),
    )
    const res = await api.delete('/push/unsubscribe/', { endpoint: 'https://x' })
    const data = await res.json()
    expect(data.endpoint).toBe('https://x')
  })

  it('refreshes token on 401 and retries', async () => {
    let attempt = 0
    server.use(
      http.get(`${BASE}/dashboard/`, () => {
        attempt++
        if (attempt === 1) return new HttpResponse(null, { status: 401 })
        return HttpResponse.json({ due: [], upcoming: [] })
      }),
    )
    const res = await api.get('/dashboard/')
    expect(res.ok).toBe(true)
    expect(attempt).toBe(2)
    expect(localStorage.getItem('access_token')).toBe('new-access')
    expect(localStorage.getItem('refresh_token')).toBe('new-refresh')
  })

  it('clears storage and redirects on failed refresh', async () => {
    server.use(
      http.get(`${BASE}/dashboard/`, () => new HttpResponse(null, { status: 401 })),
      http.post(`${BASE}/auth/refresh/`, () => new HttpResponse(null, { status: 401 })),
    )
    await api.get('/dashboard/')
    expect(localStorage.getItem('access_token')).toBeNull()
    expect(window.location.href).toBe('/login')
  })

  it('deduplicates concurrent refresh token requests', async () => {
    let refreshCount = 0
    let attempt = 0
    server.use(
      http.get(`${BASE}/dashboard/`, () => {
        attempt++
        if (attempt <= 2) return new HttpResponse(null, { status: 401 })
        return HttpResponse.json({ due: [], upcoming: [] })
      }),
      http.post(`${BASE}/auth/refresh/`, () => {
        refreshCount++
        return HttpResponse.json({ access: 'new-access', refresh: 'new-refresh' })
      }),
    )
    // Fire two requests concurrently that both get 401
    const [res1, res2] = await Promise.all([api.get('/dashboard/'), api.get('/dashboard/')])
    // Only one refresh call should have been made (mutex deduplicated)
    expect(refreshCount).toBe(1)
  })

  it('clears storage when no refresh token available', async () => {
    localStorage.removeItem('refresh_token')
    server.use(http.get(`${BASE}/dashboard/`, () => new HttpResponse(null, { status: 401 })))
    await api.get('/dashboard/')
    expect(localStorage.getItem('access_token')).toBeNull()
  })

  // ── Idempotency-Key ───────────────────────────────────────────────────────
  it('POST generates a UUIDv4 Idempotency-Key header automatically', async () => {
    let captured = null
    server.use(
      http.post(`${BASE}/routines/`, ({ request }) => {
        captured = request.headers.get('Idempotency-Key')
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    await api.post('/routines/', { name: 'x' })
    expect(captured).toMatch(UUIDV4_RE)
  })

  it('PATCH and DELETE also generate Idempotency-Key', async () => {
    let patchKey = null
    let deleteKey = null
    server.use(
      http.patch(`${BASE}/routines/1/`, ({ request }) => {
        patchKey = request.headers.get('Idempotency-Key')
        return HttpResponse.json({})
      }),
      http.delete(`${BASE}/routines/1/`, ({ request }) => {
        deleteKey = request.headers.get('Idempotency-Key')
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await api.patch('/routines/1/', { name: 'x' })
    await api.delete('/routines/1/')
    expect(patchKey).toMatch(UUIDV4_RE)
    expect(deleteKey).toMatch(UUIDV4_RE)
    expect(patchKey).not.toBe(deleteKey)
  })

  it('Idempotency-Key can be overridden via opts.idempotencyKey', async () => {
    let captured = null
    server.use(
      http.post(`${BASE}/routines/`, ({ request }) => {
        captured = request.headers.get('Idempotency-Key')
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    await api.post('/routines/', { name: 'x' }, { idempotencyKey: 'caller-key-42' })
    expect(captured).toBe('caller-key-42')
  })

  it('Idempotency-Key can be overridden via opts.headers', async () => {
    let captured = null
    server.use(
      http.post(`${BASE}/routines/`, ({ request }) => {
        captured = request.headers.get('Idempotency-Key')
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    await api.post('/routines/', { name: 'x' }, { headers: { 'Idempotency-Key': 'via-header' } })
    expect(captured).toBe('via-header')
  })

  it('GET does NOT include Idempotency-Key', async () => {
    let captured = 'unset'
    server.use(
      http.get(`${BASE}/auth/me/`, ({ request }) => {
        captured = request.headers.get('Idempotency-Key')
        return HttpResponse.json({ username: 'testuser' })
      }),
    )
    await api.get('/auth/me/')
    expect(captured).toBeNull()
  })

  it('reuses the same Idempotency-Key after a 401 token refresh', async () => {
    const keys = []
    let attempt = 0
    server.use(
      http.post(`${BASE}/routines/`, ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'))
        attempt++
        if (attempt === 1) return new HttpResponse(null, { status: 401 })
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    await api.post('/routines/', { name: 'x' })
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatch(UUIDV4_RE)
    expect(keys[0]).toBe(keys[1])
  })

  // ── If-Unmodified-Since ───────────────────────────────────────────────────
  it('PATCH with ifUnmodifiedSince includes an HTTP-date header', async () => {
    let captured = 'unset'
    server.use(
      http.patch(`${BASE}/routines/1/`, ({ request }) => {
        captured = request.headers.get('If-Unmodified-Since')
        return HttpResponse.json({})
      }),
    )
    const ts = '2026-04-17T10:00:00.000Z'
    await api.patch('/routines/1/', { name: 'x' }, { ifUnmodifiedSince: ts })
    expect(captured).toBe(new Date(ts).toUTCString())
  })

  it('PATCH without ifUnmodifiedSince omits the header', async () => {
    let captured = 'unset'
    server.use(
      http.patch(`${BASE}/routines/1/`, ({ request }) => {
        captured = request.headers.get('If-Unmodified-Since')
        return HttpResponse.json({})
      }),
    )
    await api.patch('/routines/1/', { name: 'x' })
    expect(captured).toBeNull()
  })

  it('DELETE supports ifUnmodifiedSince', async () => {
    let captured = 'unset'
    server.use(
      http.delete(`${BASE}/routines/1/`, ({ request }) => {
        captured = request.headers.get('If-Unmodified-Since')
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await api.delete('/routines/1/', undefined, { ifUnmodifiedSince: '2026-04-17T10:00:00.000Z' })
    expect(captured).toBe(new Date('2026-04-17T10:00:00.000Z').toUTCString())
  })

  it('does not leak client-only options into fetch', async () => {
    // If idempotencyKey or ifUnmodifiedSince leaked into `fetch(…, init)`
    // RequestInit, the fetch would throw; we assert the request succeeds
    // and captures the resolved headers only.
    let captured = null
    server.use(
      http.patch(`${BASE}/stock/7/`, ({ request }) => {
        captured = {
          idem: request.headers.get('Idempotency-Key'),
          since: request.headers.get('If-Unmodified-Since'),
        }
        return HttpResponse.json({})
      }),
    )
    await api.patch(
      '/stock/7/',
      { name: 'x' },
      {
        idempotencyKey: 'k-42',
        ifUnmodifiedSince: '2026-04-17T10:00:00.000Z',
      },
    )
    expect(captured.idem).toBe('k-42')
    expect(captured.since).toBe(new Date('2026-04-17T10:00:00.000Z').toUTCString())
  })

  // ── Typed errors ──────────────────────────────────────────────────────────
  it('throws OfflineError when the network fails', async () => {
    server.use(mockNetworkError('post', '/routines/'))
    await expect(api.post('/routines/', { name: 'x' })).rejects.toBeInstanceOf(OfflineError)
  })

  it('OfflineError exposes the underlying error', async () => {
    server.use(mockNetworkError('post', '/routines/'))
    try {
      await api.post('/routines/', { name: 'x' })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(OfflineError)
      expect(err.originalError).toBeInstanceOf(Error)
    }
  })

  it('throws ConflictError with `current` payload on 412', async () => {
    const serverVersion = { id: 1, name: 'server-side', updated_at: '2026-04-17T10:00:00Z' }
    server.use(mockConflict('patch', '/routines/1/', serverVersion))
    try {
      await api.patch('/routines/1/', { name: 'client-side' })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError)
      expect(err.current).toEqual(serverVersion)
    }
  })

  it('ConflictError gracefully handles an empty 412 body', async () => {
    server.use(http.patch(`${BASE}/routines/1/`, () => new HttpResponse(null, { status: 412 })))
    try {
      await api.patch('/routines/1/', { name: 'x' })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError)
      expect(err.current).toBeUndefined()
    }
  })

  // ── Reachability integration (T057) ──────────────────────────────────────
  it('flips reachability to false when fetch rejects (OfflineError path)', async () => {
    server.use(mockNetworkError('post', '/routines/'))
    await expect(api.post('/routines/', { name: 'x' })).rejects.toBeInstanceOf(OfflineError)
    expect(getReachable()).toBe(false)
  })

  it('flips reachability back to true as soon as any HTTP response arrives', async () => {
    // Seed the state as unreachable first, then perform a successful call.
    server.use(mockNetworkError('get', '/dashboard/'))
    await expect(api.get('/dashboard/')).rejects.toBeInstanceOf(OfflineError)
    expect(getReachable()).toBe(false)

    server.resetHandlers()
    const res = await api.get('/auth/me/')
    expect(res.ok).toBe(true)
    expect(getReachable()).toBe(true)
  })

  it('counts even 4xx and 5xx responses as reachable (server is alive)', async () => {
    server.use(http.get(`${BASE}/dashboard/`, () => new HttpResponse(null, { status: 503 })))
    const res = await api.get('/dashboard/')
    expect(res.status).toBe(503)
    expect(getReachable()).toBe(true)
  })
})
