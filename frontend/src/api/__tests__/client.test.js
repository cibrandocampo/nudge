import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { api } from '../client'

const BASE = 'http://localhost/api'

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

  it('clears storage when no refresh token available', async () => {
    localStorage.removeItem('refresh_token')
    server.use(http.get(`${BASE}/dashboard/`, () => new HttpResponse(null, { status: 401 })))
    await api.get('/dashboard/')
    expect(localStorage.getItem('access_token')).toBeNull()
  })
})
