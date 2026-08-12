import 'fake-indexeddb/auto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../test/mocks/server'
import { clear, list } from '../../../offline/queue'
import { mockNetworkError } from '../../../test/mocks/handlers'
import { OfflineError } from '../../../api/errors'
import { useToggleStockPin } from '../useToggleStockPin'

const BASE = 'http://localhost/api'

const stock = (over = {}) => ({ id: 7, name: 'Insulin', is_pinned: false, ...over })

function renderWithCache(seed) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  if (seed) {
    qc.setQueryData(['stock'], seed)
    for (const s of seed) qc.setQueryData(['stock', s.id], s)
  }
  const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useToggleStockPin(), { wrapper })
  return { result, qc }
}

beforeEach(async () => {
  await clear()
  localStorage.setItem('access_token', 'test-token')
})

afterEach(async () => {
  await clear()
  localStorage.clear()
})

describe('useToggleStockPin', () => {
  it('writes the pinned stock the server returns into both caches', async () => {
    server.use(http.post(`${BASE}/stock/7/pin/`, () => HttpResponse.json(stock({ is_pinned: true }))))
    const { result, qc } = renderWithCache([stock(), stock({ id: 8, name: 'Lancets' })])

    await act(async () => {
      await result.current.mutateAsync({ stockId: 7, pinned: true })
    })

    expect(qc.getQueryData(['stock', 7]).is_pinned).toBe(true)
    expect(qc.getQueryData(['stock']).find((s) => s.id === 7).is_pinned).toBe(true)
    // Untouched neighbours stay as they were.
    expect(qc.getQueryData(['stock']).find((s) => s.id === 8).is_pinned).toBe(false)
  })

  it('clears the flag locally on unpin, which answers 204 with no body', async () => {
    server.use(http.delete(`${BASE}/stock/7/pin/`, () => new HttpResponse(null, { status: 204 })))
    const { result, qc } = renderWithCache([stock({ is_pinned: true })])

    await act(async () => {
      await result.current.mutateAsync({ stockId: 7, pinned: false })
    })

    expect(qc.getQueryData(['stock', 7]).is_pinned).toBe(false)
    expect(qc.getQueryData(['stock'])[0].is_pinned).toBe(false)
  })

  it('leaves an absent cache alone rather than inventing an entry on unpin', async () => {
    server.use(http.delete(`${BASE}/stock/7/pin/`, () => new HttpResponse(null, { status: 204 })))
    const { result, qc } = renderWithCache(null)

    await act(async () => {
      await result.current.mutateAsync({ stockId: 7, pinned: false })
    })

    expect(qc.getQueryData(['stock', 7])).toBeUndefined()
  })

  it('surfaces the cap rejection with its code and limit', async () => {
    server.use(
      http.post(`${BASE}/stock/7/pin/`, () =>
        HttpResponse.json({ code: 'max_pinned_reached', max: 4, detail: 'nope' }, { status: 400 }),
      ),
    )
    const { result } = renderWithCache([stock()])

    let caught
    await act(async () => {
      caught = await result.current.mutateAsync({ stockId: 7, pinned: true }).catch((e) => e)
    })

    expect(caught.status).toBe(400)
    expect(caught.body.code).toBe('max_pinned_reached')
    expect(caught.body.max).toBe(4)
  })

  it('reports a failed unpin instead of pretending it worked', async () => {
    server.use(http.delete(`${BASE}/stock/7/pin/`, () => new HttpResponse(null, { status: 500 })))
    const { result, qc } = renderWithCache([stock({ is_pinned: true })])

    let caught
    await act(async () => {
      caught = await result.current.mutateAsync({ stockId: 7, pinned: false }).catch((e) => e)
    })

    expect(caught.status).toBe(500)
    // The cache must still say pinned: nothing changed on the server.
    expect(qc.getQueryData(['stock', 7]).is_pinned).toBe(true)
  })

  it('rejects offline rather than enqueueing — this mutation is not queueable', async () => {
    // The decision is documented in the hook: the cap is server-side, so a
    // queued pin could only fail later with nothing the user can do about it.
    server.use(mockNetworkError('post', '/stock/7/pin/'))
    const { result } = renderWithCache([stock()])

    let caught
    await act(async () => {
      caught = await result.current.mutateAsync({ stockId: 7, pinned: true }).catch((e) => e)
    })

    expect(caught).toBeInstanceOf(OfflineError)
    expect(await list()).toHaveLength(0)
  })
})
