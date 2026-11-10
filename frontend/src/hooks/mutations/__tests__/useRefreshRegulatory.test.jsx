import 'fake-indexeddb/auto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../test/mocks/server'
import { clear, list } from '../../../offline/queue'
import { mockNetworkError } from '../../../test/mocks/handlers'
import { OfflineError } from '../../../api/errors'
import { useRefreshRegulatory } from '../useRefreshRegulatory'

const BASE = 'http://localhost/api'

const stock = (fetchStatus) => ({ id: 7, name: 'Insulin', regulatory: { fetch_status: fetchStatus } })

function renderWithCache(seed) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  qc.setQueryData(['stock'], seed)
  for (const s of seed) qc.setQueryData(['stock', s.id], s)
  const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useRefreshRegulatory(), { wrapper })
  return { result, qc }
}

async function settle(result, args) {
  let caught
  await act(async () => {
    try {
      await result.current.mutateAsync(args)
    } catch (err) {
      caught = err
    }
  })
  return caught
}

beforeEach(async () => {
  await clear()
  localStorage.setItem('access_token', 'test-token')
})

afterEach(async () => {
  await clear()
  localStorage.clear()
})

describe('useRefreshRegulatory', () => {
  it('writes the returned (pending) stock into both caches', async () => {
    let posted = false
    server.use(
      http.post(`${BASE}/stock/7/regulatory/refresh/`, () => {
        posted = true
        return HttpResponse.json(stock('pending'), { status: 202 })
      }),
    )
    const { result, qc } = renderWithCache([stock('ok'), { id: 8, name: 'Lancets', regulatory: null }])

    expect(await settle(result, { stockId: 7 })).toBeUndefined()
    expect(posted).toBe(true)
    expect(qc.getQueryData(['stock', 7]).regulatory.fetch_status).toBe('pending')
    expect(qc.getQueryData(['stock']).find((s) => s.id === 7).regulatory.fetch_status).toBe('pending')
    expect(qc.getQueryData(['stock']).find((s) => s.id === 8).name).toBe('Lancets')
  })

  it('rejects a refusal with its status and body', async () => {
    server.use(
      http.post(`${BASE}/stock/7/regulatory/refresh/`, () =>
        HttpResponse.json({ code: 'no_national_code' }, { status: 400 }),
      ),
    )
    const { result } = renderWithCache([stock('ok')])
    const err = await settle(result, { stockId: 7 })
    expect(err.status).toBe(400)
    expect(err.body).toEqual({ code: 'no_national_code' })
  })

  it('a refusal without a JSON body still rejects', async () => {
    server.use(http.post(`${BASE}/stock/7/regulatory/refresh/`, () => new HttpResponse('x', { status: 500 })))
    const { result } = renderWithCache([stock('ok')])
    const err = await settle(result, { stockId: 7 })
    expect(err.status).toBe(500)
    expect(err.body).toBeNull()
  })

  it('is online-only: a network failure rejects and never enqueues', async () => {
    server.use(mockNetworkError('post', '/stock/7/regulatory/refresh/'))
    const { result } = renderWithCache([stock('ok')])
    expect(await settle(result, { stockId: 7 })).toBeInstanceOf(OfflineError)
    expect(await list()).toHaveLength(0)
  })
})
