import 'fake-indexeddb/auto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockNetworkError } from '../../test/mocks/handlers'
import { server } from '../../test/mocks/server'
import { clear } from '../../offline/queue'
import { useEntries, useStockConsumptions } from '../useEntries'
import { useContacts, useContactSearch } from '../useContacts'
import { useUpdateEntry } from '../mutations/useUpdateEntry'
import { useUpdateConsumption } from '../mutations/useUpdateConsumption'
import { useUpdateMe } from '../mutations/useUpdateMe'
import { useChangePassword } from '../mutations/useChangePassword'
import { useCreateContact } from '../mutations/useCreateContact'
import { useDeleteContact } from '../mutations/useDeleteContact'
import { useSubscribePush } from '../mutations/useSubscribePush'
import { useUnsubscribePush } from '../mutations/useUnsubscribePush'

const BASE = 'http://localhost/api'

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function renderWith(hookFn, qc = makeClient()) {
  const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { result, rerender } = renderHook(hookFn, { wrapper })
  return { result, qc, rerender }
}

beforeEach(async () => {
  await clear()
  localStorage.setItem('access_token', 'test-token')
})

afterEach(async () => {
  await clear()
  localStorage.clear()
})

describe('useEntries (infinite query)', () => {
  it('paginates via fetchNextPage', async () => {
    server.use(
      http.get(`${BASE}/entries/`, ({ request }) => {
        const page = new URL(request.url).searchParams.get('page')
        if (page === '1') {
          return HttpResponse.json({ results: [{ id: 1 }], next: '/api/entries/?page=2' })
        }
        return HttpResponse.json({ results: [{ id: 2 }], next: null })
      }),
    )
    const { result } = renderWith(() => useEntries({ dateFrom: '2026-01-01', dateTo: '2026-01-31' }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.pages).toHaveLength(1)
    expect(result.current.data.pages[0].items).toEqual([{ id: 1 }])
    expect(result.current.hasNextPage).toBe(true)

    await act(async () => {
      await result.current.fetchNextPage()
    })
    await waitFor(() => expect(result.current.data.pages).toHaveLength(2))
    expect(result.current.hasNextPage).toBe(false)
  })

  it('is disabled when filters.enabled is false', () => {
    const { result } = renderWith(() => useEntries({ enabled: false }))
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('accepts a routine filter and forwards it on the wire', async () => {
    let received = null
    server.use(
      http.get(`${BASE}/entries/`, ({ request }) => {
        received = new URL(request.url).searchParams.get('routine')
        return HttpResponse.json({ results: [], next: null })
      }),
    )
    const { result } = renderWith(() => useEntries({ routine: '7' }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(received).toBe('7')
  })

  it('accepts a bare array (not wrapped in results)', async () => {
    server.use(http.get(`${BASE}/entries/`, () => HttpResponse.json([{ id: 42 }])))
    const { result } = renderWith(() => useEntries({}))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.pages[0].items).toEqual([{ id: 42 }])
  })
})

describe('useStockConsumptions', () => {
  it('returns the results array', async () => {
    server.use(http.get(`${BASE}/stock-consumptions/`, () => HttpResponse.json({ results: [{ id: 5 }], next: null })))
    const { result } = renderWith(() => useStockConsumptions({}))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 5 }])
  })

  it('forwards stock + date filters', async () => {
    let params = null
    server.use(
      http.get(`${BASE}/stock-consumptions/`, ({ request }) => {
        params = Object.fromEntries(new URL(request.url).searchParams)
        return HttpResponse.json({ results: [], next: null })
      }),
    )
    const { result } = renderWith(() =>
      useStockConsumptions({ stock: '3', dateFrom: '2026-01-01', dateTo: '2026-01-31' }),
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(params).toEqual({ stock: '3', date_from: '2026-01-01', date_to: '2026-01-31' })
  })

  it('is disabled when filters.enabled is false', () => {
    const { result } = renderWith(() => useStockConsumptions({ enabled: false }))
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('accepts a bare array response', async () => {
    server.use(http.get(`${BASE}/stock-consumptions/`, () => HttpResponse.json([{ id: 9 }])))
    const { result } = renderWith(() => useStockConsumptions({}))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 9 }])
  })
})

describe('useContacts / useContactSearch', () => {
  it('useContacts returns the list', async () => {
    server.use(http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json([{ id: 10 }])))
    const { result } = renderWith(() => useContacts())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 10 }])
  })

  it('useContacts surfaces errors with status', async () => {
    server.use(http.get(`${BASE}/auth/contacts/`, () => new HttpResponse(null, { status: 500 })))
    const { result } = renderWith(() => useContacts())
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error.status).toBe(500)
  })

  it('useContactSearch is disabled for short queries', () => {
    const { result } = renderWith(() => useContactSearch('a'))
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('useContactSearch debounces and fetches matching users', async () => {
    server.use(
      http.get(`${BASE}/auth/contacts/search/`, ({ request }) => {
        const q = new URL(request.url).searchParams.get('q')
        return HttpResponse.json([{ id: 99, username: q }])
      }),
    )
    const { result } = renderWith(() => useContactSearch('bob', 10))
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 2000 })
    expect(result.current.data).toEqual([{ id: 99, username: 'bob' }])
  })
})

describe('entry/consumption/me/contact mutations', () => {
  it('useUpdateEntry merges the response into the paginated cache', async () => {
    server.use(
      http.patch(`${BASE}/entries/1/`, async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({ id: 1, notes: body.notes })
      }),
    )
    const { result, qc } = renderWith(() => useUpdateEntry())
    const filterKey = { dateFrom: '2026-01-01' }
    qc.setQueryData(['entries', filterKey], {
      pages: [{ items: [{ id: 1, notes: 'old' }], next: null, page: 1 }],
      pageParams: [1],
    })

    await act(async () => {
      await result.current.mutateAsync({ entryId: 1, patch: { notes: 'new' } })
    })
    const cached = qc.getQueryData(['entries', filterKey])
    expect(cached.pages[0].items).toEqual([{ id: 1, notes: 'new' }])
  })

  it('useUpdateEntry invalidates when queued offline', async () => {
    server.use(mockNetworkError('patch', '/entries/1/'))
    const { result } = renderWith(() => useUpdateEntry())

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({ entryId: 1, patch: { notes: 'x' } })
    })
    expect(returned).toEqual({ __queued: true })
  })

  it('useUpdateConsumption merges the response into the flat cache', async () => {
    server.use(
      http.patch(`${BASE}/stock-consumptions/5/`, async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({ id: 5, notes: body.notes })
      }),
    )
    const { result, qc } = renderWith(() => useUpdateConsumption())
    qc.setQueryData(['stock-consumptions', { stock: '3' }], [{ id: 5, notes: 'old' }])

    await act(async () => {
      await result.current.mutateAsync({ consumptionId: 5, patch: { notes: 'new' } })
    })
    expect(qc.getQueryData(['stock-consumptions', { stock: '3' }])).toEqual([{ id: 5, notes: 'new' }])
  })

  it('useUpdateConsumption invalidates when queued offline', async () => {
    server.use(mockNetworkError('patch', '/stock-consumptions/5/'))
    const { result } = renderWith(() => useUpdateConsumption())

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({ consumptionId: 5, patch: { notes: 'x' } })
    })
    expect(returned).toEqual({ __queued: true })
  })

  it('useUpdateMe merges the response into the me cache', async () => {
    server.use(
      http.patch(`${BASE}/auth/me/`, async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({ id: 1, username: 'alice', ...body })
      }),
    )
    const { result, qc } = renderWith(() => useUpdateMe())
    qc.setQueryData(['me'], { id: 1, username: 'alice', language: 'en' })

    await act(async () => {
      await result.current.mutateAsync({ patch: { language: 'es' } })
    })
    expect(qc.getQueryData(['me']).language).toBe('es')
  })

  it('useUpdateMe rejects with OfflineError offline (online-only)', async () => {
    server.use(mockNetworkError('patch', '/auth/me/'))
    const { result } = renderWith(() => useUpdateMe())

    let caught = null
    await act(async () => {
      try {
        await result.current.mutateAsync({ patch: { language: 'es' } })
      } catch (err) {
        caught = err
      }
    })
    expect(caught?.name).toBe('OfflineError')
  })

  it('useChangePassword posts old + new password', async () => {
    let body = null
    server.use(
      http.post(`${BASE}/auth/change-password/`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ detail: 'ok' })
      }),
    )
    const { result } = renderWith(() => useChangePassword())

    await act(async () => {
      await result.current.mutateAsync({ oldPassword: 'old', newPassword: 'new' })
    })
    expect(body).toEqual({ old_password: 'old', new_password: 'new' })
  })

  it('useChangePassword rejects with OfflineError offline (online-only)', async () => {
    server.use(mockNetworkError('post', '/auth/change-password/'))
    const { result } = renderWith(() => useChangePassword())

    let caught = null
    await act(async () => {
      try {
        await result.current.mutateAsync({ oldPassword: 'old', newPassword: 'new' })
      } catch (err) {
        caught = err
      }
    })
    expect(caught?.name).toBe('OfflineError')
  })

  it('useCreateContact appends to cache on success', async () => {
    server.use(
      http.post(`${BASE}/auth/contacts/`, () => HttpResponse.json({ id: 50, username: 'bob' }, { status: 201 })),
    )
    const { result, qc } = renderWith(() => useCreateContact())
    qc.setQueryData(['contacts'], [{ id: 10, username: 'alice' }])

    await act(async () => {
      await result.current.mutateAsync({ username: 'bob' })
    })
    expect(qc.getQueryData(['contacts'])).toEqual([
      { id: 10, username: 'alice' },
      { id: 50, username: 'bob' },
    ])
  })

  it('useCreateContact skips append when id is already cached', async () => {
    server.use(
      http.post(`${BASE}/auth/contacts/`, () => HttpResponse.json({ id: 10, username: 'alice' }, { status: 201 })),
    )
    const { result, qc } = renderWith(() => useCreateContact())
    qc.setQueryData(['contacts'], [{ id: 10, username: 'alice' }])

    await act(async () => {
      await result.current.mutateAsync({ username: 'alice' })
    })
    expect(qc.getQueryData(['contacts'])).toEqual([{ id: 10, username: 'alice' }])
  })

  it('useCreateContact rejects with OfflineError offline (online-only)', async () => {
    server.use(mockNetworkError('post', '/auth/contacts/'))
    const { result } = renderWith(() => useCreateContact())

    let caught = null
    await act(async () => {
      try {
        await result.current.mutateAsync({ username: 'bob' })
      } catch (err) {
        caught = err
      }
    })
    expect(caught?.name).toBe('OfflineError')
  })

  it('useDeleteContact removes the contact from cache on success', async () => {
    server.use(http.delete(`${BASE}/auth/contacts/10/`, () => new HttpResponse(null, { status: 204 })))
    const { result, qc } = renderWith(() => useDeleteContact())
    qc.setQueryData(['contacts'], [{ id: 10 }, { id: 11 }])

    await act(async () => {
      await result.current.mutateAsync({ contactId: 10 })
    })
    expect(qc.getQueryData(['contacts'])).toEqual([{ id: 11 }])
  })

  it('useSubscribePush posts the subscription payload', async () => {
    let body = null
    server.use(
      http.post(`${BASE}/push/subscribe/`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    const { result } = renderWith(() => useSubscribePush())

    await act(async () => {
      await result.current.mutateAsync({ endpoint: 'https://push.example/sub', keys: { p256dh: 'a', auth: 'b' } })
    })
    expect(body).toEqual({ endpoint: 'https://push.example/sub', keys: { p256dh: 'a', auth: 'b' } })
  })

  it('useUnsubscribePush sends DELETE with the endpoint', async () => {
    let body = null
    server.use(
      http.delete(`${BASE}/push/unsubscribe/`, async ({ request }) => {
        body = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { result } = renderWith(() => useUnsubscribePush())

    await act(async () => {
      await result.current.mutateAsync({ endpoint: 'https://push.example/sub' })
    })
    expect(body).toEqual({ endpoint: 'https://push.example/sub' })
  })

  it('useSubscribePush rejects with OfflineError offline (online-only)', async () => {
    server.use(mockNetworkError('post', '/push/subscribe/'))
    const { result } = renderWith(() => useSubscribePush())

    let caught = null
    await act(async () => {
      try {
        await result.current.mutateAsync({ endpoint: 'https://push.example/sub', keys: {} })
      } catch (err) {
        caught = err
      }
    })
    expect(caught?.name).toBe('OfflineError')
  })

  it('useUnsubscribePush rejects with OfflineError offline (online-only)', async () => {
    server.use(mockNetworkError('delete', '/push/unsubscribe/'))
    const { result } = renderWith(() => useUnsubscribePush())

    let caught = null
    await act(async () => {
      try {
        await result.current.mutateAsync({ endpoint: 'https://push.example/sub' })
      } catch (err) {
        caught = err
      }
    })
    expect(caught?.name).toBe('OfflineError')
  })

  it('useUpdateEntry tolerates a malformed paginated cache', async () => {
    server.use(http.patch(`${BASE}/entries/1/`, () => HttpResponse.json({ id: 1, notes: 'x' })))
    const { result, qc } = renderWith(() => useUpdateEntry())
    // Seed a non-paginated shape — the defensive branch should leave it alone.
    qc.setQueryData(['entries', { any: 'thing' }], { broken: true })

    await act(async () => {
      await result.current.mutateAsync({ entryId: 1, patch: { notes: 'x' } })
    })
    expect(qc.getQueryData(['entries', { any: 'thing' }])).toEqual({ broken: true })
  })

  it('useUpdateConsumption tolerates a non-array cache value', async () => {
    server.use(http.patch(`${BASE}/stock-consumptions/5/`, () => HttpResponse.json({ id: 5, notes: 'x' })))
    const { result, qc } = renderWith(() => useUpdateConsumption())
    qc.setQueryData(['stock-consumptions', { any: 'thing' }], { not: 'an array' })

    await act(async () => {
      await result.current.mutateAsync({ consumptionId: 5, patch: { notes: 'x' } })
    })
    expect(qc.getQueryData(['stock-consumptions', { any: 'thing' }])).toEqual({ not: 'an array' })
  })

  it('useUpdateConsumption leaves non-matching items untouched when merging', async () => {
    server.use(
      http.patch(`${BASE}/stock-consumptions/5/`, async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({ id: 5, notes: body.notes })
      }),
    )
    const { result, qc } = renderWith(() => useUpdateConsumption())
    qc.setQueryData(
      ['stock-consumptions', { stock: '3' }],
      [
        { id: 5, notes: 'old' },
        { id: 99, notes: 'untouched' },
      ],
    )

    await act(async () => {
      await result.current.mutateAsync({ consumptionId: 5, patch: { notes: 'new' } })
    })
    expect(qc.getQueryData(['stock-consumptions', { stock: '3' }])).toEqual([
      { id: 5, notes: 'new' },
      { id: 99, notes: 'untouched' },
    ])
  })
})
