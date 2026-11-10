import 'fake-indexeddb/auto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../test/mocks/server'
import { clear, list } from '../../../offline/queue'
import { mockNetworkError } from '../../../test/mocks/handlers'
import { OfflineError } from '../../../api/errors'
import { useAnswerNameOffer } from '../useAnswerNameOffer'

const BASE = 'http://localhost/api'
const OFFICIAL = 'FIASP 100 UNIDADES/ML PUMPCART SOLUCION INYECTABLE EN CARTUCHO'

const stock = (over = {}) => ({
  id: 7,
  name: 'Insulin',
  regulatory: { official_name: OFFICIAL, name_offer_pending: true, fetch_status: 'ok' },
  ...over,
})

function renderWithCache(seed) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  qc.setQueryData(['stock'], seed)
  for (const s of seed) qc.setQueryData(['stock', s.id], s)
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useAnswerNameOffer(), { wrapper })
  return { result, qc, invalidate }
}

const invalidatedKeys = (invalidate) => invalidate.mock.calls.map(([arg]) => JSON.stringify(arg.queryKey))

beforeEach(async () => {
  await clear()
  localStorage.setItem('access_token', 'test-token')
})

afterEach(async () => {
  await clear()
  localStorage.clear()
})

describe('useAnswerNameOffer', () => {
  it('posts the answer and writes the returned stock into both caches', async () => {
    let body
    const answered = stock({ name: OFFICIAL, regulatory: { ...stock().regulatory, name_offer_pending: false } })
    server.use(
      http.post(`${BASE}/stock/7/regulatory/name-offer/`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(answered)
      }),
    )
    const { result, qc } = renderWithCache([stock(), stock({ id: 8, name: 'Lancets', regulatory: null })])

    await act(async () => {
      await result.current.mutateAsync({ stockId: 7, accept: true })
    })

    expect(body).toEqual({ accept: true })
    expect(qc.getQueryData(['stock', 7]).name).toBe(OFFICIAL)
    expect(qc.getQueryData(['stock']).find((s) => s.id === 7).regulatory.name_offer_pending).toBe(false)
    expect(qc.getQueryData(['stock']).find((s) => s.id === 8).name).toBe('Lancets')
  })

  it('refreshes the caches that show the stock name after accepting', async () => {
    server.use(http.post(`${BASE}/stock/7/regulatory/name-offer/`, () => HttpResponse.json(stock({ name: OFFICIAL }))))
    const { result, invalidate } = renderWithCache([stock()])

    await act(async () => {
      await result.current.mutateAsync({ stockId: 7, accept: true })
    })

    expect(invalidatedKeys(invalidate)).toEqual(
      expect.arrayContaining(['["stock"]', '["dashboard"]', '["entries"]', '["stock-consumptions"]']),
    )
  })

  it('only refreshes the stock caches after declining', async () => {
    server.use(http.post(`${BASE}/stock/7/regulatory/name-offer/`, () => HttpResponse.json(stock())))
    const { result, invalidate } = renderWithCache([stock()])

    await act(async () => {
      await result.current.mutateAsync({ stockId: 7, accept: false })
    })

    expect(invalidatedKeys(invalidate)).toEqual(['["stock"]'])
  })

  it('treats a 409 (no official name any more) as nothing to report', async () => {
    server.use(
      http.post(`${BASE}/stock/7/regulatory/name-offer/`, () =>
        HttpResponse.json({ code: 'official_name_unavailable' }, { status: 409 }),
      ),
    )
    const { result, qc, invalidate } = renderWithCache([stock()])

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({ stockId: 7, accept: true })
    })

    expect(returned).toBeNull()
    // The cache is left for the refetch to correct, not hand-patched.
    expect(qc.getQueryData(['stock', 7]).name).toBe('Insulin')
    expect(invalidatedKeys(invalidate)).toContain('["stock"]')
  })

  it('rejects other refusals with their status and body', async () => {
    server.use(
      http.post(`${BASE}/stock/7/regulatory/name-offer/`, () =>
        HttpResponse.json({ code: 'invalid_body' }, { status: 400 }),
      ),
    )
    const { result } = renderWithCache([stock()])

    let caught
    await act(async () => {
      try {
        await result.current.mutateAsync({ stockId: 7, accept: true })
      } catch (err) {
        caught = err
      }
    })

    expect(caught.status).toBe(400)
    expect(caught.body).toEqual({ code: 'invalid_body' })
  })

  it('a refusal without a JSON body still rejects', async () => {
    server.use(http.post(`${BASE}/stock/7/regulatory/name-offer/`, () => new HttpResponse('boom', { status: 500 })))
    const { result } = renderWithCache([stock()])

    let caught
    await act(async () => {
      try {
        await result.current.mutateAsync({ stockId: 7, accept: true })
      } catch (err) {
        caught = err
      }
    })

    expect(caught.status).toBe(500)
    expect(caught.body).toBeNull()
  })

  it('is online-only: a network failure rejects and never enqueues', async () => {
    server.use(mockNetworkError('post', '/stock/7/regulatory/name-offer/'))
    const { result } = renderWithCache([stock()])

    let caught
    await act(async () => {
      try {
        await result.current.mutateAsync({ stockId: 7, accept: false })
      } catch (err) {
        caught = err
      }
    })

    expect(caught).toBeInstanceOf(OfflineError)
    expect(await list()).toHaveLength(0)
  })
})
