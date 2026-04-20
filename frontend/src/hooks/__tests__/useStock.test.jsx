import 'fake-indexeddb/auto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockNetworkError } from '../../test/mocks/handlers'
import { server } from '../../test/mocks/server'
import { clear, list } from '../../offline/queue'
import { useStock, useStockGroups, useStockList, useStockLots } from '../useStock'
import { useCreateStock } from '../mutations/useCreateStock'
import { useUpdateStock } from '../mutations/useUpdateStock'
import { useDeleteStock } from '../mutations/useDeleteStock'
import { useConsumeStock } from '../mutations/useConsumeStock'
import { useCreateStockLot } from '../mutations/useCreateStockLot'
import { useUpdateStockLot } from '../mutations/useUpdateStockLot'
import { useDeleteStockLot } from '../mutations/useDeleteStockLot'
import { useCreateStockGroup } from '../mutations/useCreateStockGroup'
import { useUpdateStockGroup } from '../mutations/useUpdateStockGroup'
import { useDeleteStockGroup } from '../mutations/useDeleteStockGroup'
import { useCreateRoutine } from '../mutations/useCreateRoutine'

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
  const { result } = renderHook(hookFn, { wrapper })
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

describe('stock query hooks', () => {
  it('useStockList unwraps paginated results', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json({ results: [{ id: 1, name: 'Soap' }] })))
    const { result } = renderWith(() => useStockList())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 1, name: 'Soap' }])
  })

  it('useStockList accepts a bare array too', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([{ id: 9 }])))
    const { result } = renderWith(() => useStockList())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 9 }])
  })

  it('useStockList surfaces errors with status', async () => {
    server.use(http.get(`${BASE}/stock/`, () => new HttpResponse(null, { status: 500 })))
    const { result } = renderWith(() => useStockList())
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error.status).toBe(500)
  })

  it('useStock is disabled when id is null', () => {
    const { result } = renderWith(() => useStock(null))
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('useStock fetches a single item', async () => {
    server.use(http.get(`${BASE}/stock/3/`, () => HttpResponse.json({ id: 3, name: 'Shampoo' })))
    const { result } = renderWith(() => useStock(3))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.name).toBe('Shampoo')
  })

  it('useStockLots is disabled when stockId is null', () => {
    const { result } = renderWith(() => useStockLots(null))
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('useStockLots fetches lot data', async () => {
    server.use(http.get(`${BASE}/stock/5/lots-for-selection/`, () => HttpResponse.json([{ lot_id: 1, quantity: 2 }])))
    const { result } = renderWith(() => useStockLots(5))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ lot_id: 1, quantity: 2 }])
  })

  it('useStockGroups unwraps paginated results', async () => {
    server.use(http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: [{ id: 2, name: 'Bath' }] })))
    const { result } = renderWith(() => useStockGroups())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 2, name: 'Bath' }])
  })

  it('useStockGroups accepts a bare array too', async () => {
    server.use(http.get(`${BASE}/stock-groups/`, () => HttpResponse.json([{ id: 4 }])))
    const { result } = renderWith(() => useStockGroups())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 4 }])
  })
})

describe('stock mutation hooks — online + offline paths', () => {
  it('useCreateStock appends new item to list cache on success', async () => {
    server.use(http.post(`${BASE}/stock/`, () => HttpResponse.json({ id: 2, name: 'Beta' }, { status: 201 })))
    const { result, qc } = renderWith(() => useCreateStock())
    qc.setQueryData(['stock'], [{ id: 1, name: 'Alpha' }])

    await act(async () => {
      await result.current.mutateAsync({ name: 'Beta' })
    })

    expect(qc.getQueryData(['stock'])).toEqual([
      { id: 1, name: 'Alpha' },
      { id: 2, name: 'Beta' },
    ])
  })

  it('useCreateStock skips the append when the id is already in cache', async () => {
    server.use(http.post(`${BASE}/stock/`, () => HttpResponse.json({ id: 1, name: 'Alpha' }, { status: 201 })))
    const { result, qc } = renderWith(() => useCreateStock())
    qc.setQueryData(['stock'], [{ id: 1, name: 'Alpha' }])

    await act(async () => {
      await result.current.mutateAsync({ name: 'Alpha' })
    })
    expect(qc.getQueryData(['stock'])).toEqual([{ id: 1, name: 'Alpha' }])
  })

  it('useCreateStock rejects with OfflineError (online-only, does not queue)', async () => {
    server.use(mockNetworkError('post', '/stock/'))
    const { result } = renderWith(() => useCreateStock())

    let caught = null
    await act(async () => {
      try {
        await result.current.mutateAsync({ name: 'Beta', group: null })
      } catch (err) {
        caught = err
      }
    })
    expect(caught).toBeInstanceOf(Error)
    expect(caught.name).toBe('OfflineError')
    expect(await list()).toHaveLength(0)
  })

  it('useUpdateStock merges server response into list + detail cache', async () => {
    server.use(http.patch(`${BASE}/stock/1/`, () => HttpResponse.json({ id: 1, name: 'Updated' })))
    const { result, qc } = renderWith(() => useUpdateStock())
    qc.setQueryData(['stock'], [{ id: 1, name: 'Old' }])

    await act(async () => {
      await result.current.mutateAsync({ stockId: 1, patch: { name: 'Updated' } })
    })
    expect(qc.getQueryData(['stock'])).toEqual([{ id: 1, name: 'Updated' }])
    expect(qc.getQueryData(['stock', 1])).toEqual({ id: 1, name: 'Updated' })
  })

  it('useUpdateStock invalidates when queued offline', async () => {
    server.use(mockNetworkError('patch', '/stock/1/'))
    const { result } = renderWith(() => useUpdateStock())

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({ stockId: 1, patch: { name: 'x' } })
    })
    expect(returned).toEqual({ __queued: true })
  })

  it('useDeleteStock removes item from cache on success', async () => {
    server.use(http.delete(`${BASE}/stock/1/`, () => new HttpResponse(null, { status: 204 })))
    const { result, qc } = renderWith(() => useDeleteStock())
    qc.setQueryData(['stock'], [{ id: 1 }, { id: 2 }])

    await act(async () => {
      await result.current.mutateAsync({ stockId: 1 })
    })
    expect(qc.getQueryData(['stock'])).toEqual([{ id: 2 }])
  })

  it('useConsumeStock merges returned stock into the cache', async () => {
    server.use(
      http.post(`${BASE}/stock/1/consume/`, async ({ request }) => {
        const body = await request.json()
        expect(body.client_created_at).toMatch(/\d{4}-\d{2}-\d{2}T/)
        return HttpResponse.json({ id: 1, name: 'Soap', quantity: 3 })
      }),
    )
    const { result, qc } = renderWith(() => useConsumeStock())
    qc.setQueryData(['stock'], [{ id: 1, quantity: 5 }])

    await act(async () => {
      await result.current.mutateAsync({ stockId: 1, quantity: 2, lotSelections: [] })
    })
    expect(qc.getQueryData(['stock'])).toEqual([{ id: 1, name: 'Soap', quantity: 3 }])
    expect(qc.getQueryData(['stock', 1])).toEqual({ id: 1, name: 'Soap', quantity: 3 })
  })

  it('useConsumeStock invalidates stock when the response has no id', async () => {
    server.use(http.post(`${BASE}/stock/1/consume/`, () => HttpResponse.json({ ok: true })))
    const { result } = renderWith(() => useConsumeStock())

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({ stockId: 1, quantity: 1, lotSelections: [] })
    })
    expect(returned).toEqual({ ok: true })
  })

  it('useCreateStockLot refreshes the parent stock into the cache', async () => {
    server.use(
      http.post(`${BASE}/stock/1/lots/`, () => HttpResponse.json({ id: 10, quantity: 3 }, { status: 201 })),
      http.get(`${BASE}/stock/1/`, () => HttpResponse.json({ id: 1, name: 'Soap', quantity: 8 })),
    )
    const { result, qc } = renderWith(() => useCreateStockLot())
    qc.setQueryData(['stock'], [{ id: 1, name: 'Soap', quantity: 5 }])

    await act(async () => {
      await result.current.mutateAsync({ stockId: 1, quantity: 3 })
    })
    expect(qc.getQueryData(['stock', 1])).toEqual({ id: 1, name: 'Soap', quantity: 8 })
  })

  it('useCreateStockLot invalidates when the parent fetch fails', async () => {
    server.use(
      http.post(`${BASE}/stock/1/lots/`, () => HttpResponse.json({ id: 10 }, { status: 201 })),
      http.get(`${BASE}/stock/1/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { result } = renderWith(() => useCreateStockLot())

    await act(async () => {
      await result.current.mutateAsync({ stockId: 1, quantity: 2, expiryDate: '2027-01-01', lotNumber: 'A' })
    })
  })

  it('useCreateStockLot invalidates when queued offline', async () => {
    server.use(mockNetworkError('post', '/stock/1/lots/'))
    const { result } = renderWith(() => useCreateStockLot())

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({ stockId: 1, quantity: 2 })
    })
    expect(returned).toEqual({ __queued: true })
  })

  it('useUpdateStockLot invalidates stock queries', async () => {
    server.use(http.patch(`${BASE}/stock/1/lots/10/`, () => HttpResponse.json({ id: 10, quantity: 5 })))
    const { result } = renderWith(() => useUpdateStockLot())

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({ stockId: 1, lotId: 10, patch: { quantity: 5 } })
    })
    expect(returned).toEqual({ id: 10, quantity: 5 })
  })

  it('useDeleteStockLot refreshes the parent stock after deletion', async () => {
    server.use(
      http.delete(`${BASE}/stock/1/lots/10/`, () => new HttpResponse(null, { status: 204 })),
      http.get(`${BASE}/stock/1/`, () => HttpResponse.json({ id: 1, quantity: 2 })),
    )
    const { result, qc } = renderWith(() => useDeleteStockLot())
    qc.setQueryData(['stock'], [{ id: 1, quantity: 5 }])

    await act(async () => {
      await result.current.mutateAsync({ stockId: 1, lotId: 10 })
    })
    expect(qc.getQueryData(['stock', 1])).toEqual({ id: 1, quantity: 2 })
  })

  it('useDeleteStockLot invalidates when the parent fetch fails', async () => {
    server.use(
      http.delete(`${BASE}/stock/1/lots/10/`, () => new HttpResponse(null, { status: 204 })),
      http.get(`${BASE}/stock/1/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { result } = renderWith(() => useDeleteStockLot())

    await act(async () => {
      await result.current.mutateAsync({ stockId: 1, lotId: 10 })
    })
  })

  it('useDeleteStockLot invalidates when queued offline', async () => {
    server.use(mockNetworkError('delete', '/stock/1/lots/10/'))
    const { result } = renderWith(() => useDeleteStockLot())

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({ stockId: 1, lotId: 10 })
    })
    expect(returned).toEqual({ __queued: true })
  })

  it('useCreateStockGroup appends to cache on success', async () => {
    server.use(http.post(`${BASE}/stock-groups/`, () => HttpResponse.json({ id: 2, name: 'Bath' }, { status: 201 })))
    const { result, qc } = renderWith(() => useCreateStockGroup())
    qc.setQueryData(['stock-groups'], [{ id: 1, name: 'Kitchen' }])

    await act(async () => {
      await result.current.mutateAsync({ name: 'Bath' })
    })
    // The append happens synchronously in onSuccess; the subsequent invalidate
    // marks the data stale but leaves it present for observers.
    const data = qc.getQueryData(['stock-groups'])
    expect(data).toEqual([
      { id: 1, name: 'Kitchen' },
      { id: 2, name: 'Bath' },
    ])
  })

  it('useCreateStockGroup skips append when id is already cached', async () => {
    server.use(http.post(`${BASE}/stock-groups/`, () => HttpResponse.json({ id: 1, name: 'Kitchen' }, { status: 201 })))
    const { result, qc } = renderWith(() => useCreateStockGroup())
    qc.setQueryData(['stock-groups'], [{ id: 1, name: 'Kitchen' }])

    await act(async () => {
      await result.current.mutateAsync({ name: 'Kitchen', displayOrder: 3 })
    })
    expect(qc.getQueryData(['stock-groups'])).toEqual([{ id: 1, name: 'Kitchen' }])
  })

  it('useUpdateStockGroup merges the response into cache', async () => {
    server.use(http.patch(`${BASE}/stock-groups/2/`, () => HttpResponse.json({ id: 2, name: 'Updated' })))
    const { result, qc } = renderWith(() => useUpdateStockGroup())
    qc.setQueryData(['stock-groups'], [{ id: 2, name: 'Old' }])

    await act(async () => {
      await result.current.mutateAsync({ groupId: 2, patch: { name: 'Updated' } })
    })
    expect(qc.getQueryData(['stock-groups'])).toEqual([{ id: 2, name: 'Updated' }])
  })

  it('useDeleteStockGroup removes group and clears group fields on stocks', async () => {
    server.use(http.delete(`${BASE}/stock-groups/2/`, () => new HttpResponse(null, { status: 204 })))
    const { result, qc } = renderWith(() => useDeleteStockGroup())
    qc.setQueryData(['stock-groups'], [{ id: 2, name: 'Bath' }])
    qc.setQueryData(
      ['stock'],
      [
        { id: 10, group: 2, group_name: 'Bath' },
        { id: 11, group: 3, group_name: 'Kitchen' },
      ],
    )

    await act(async () => {
      await result.current.mutateAsync({ groupId: 2 })
    })
    expect(qc.getQueryData(['stock-groups'])).toEqual([])
    expect(qc.getQueryData(['stock'])).toEqual([
      { id: 10, group: null, group_name: null },
      { id: 11, group: 3, group_name: 'Kitchen' },
    ])
  })

  it('useCreateRoutine invalidates routines and dashboard caches', async () => {
    server.use(http.post(`${BASE}/routines/`, () => HttpResponse.json({ id: 7, name: 'New' }, { status: 201 })))
    const { result, qc } = renderWith(() => useCreateRoutine())

    await act(async () => {
      const returned = await result.current.mutateAsync({ payload: { name: 'New', interval_hours: 24 } })
      expect(returned.id).toBe(7)
    })
    expect(qc.getQueryState(['routines'])).toBeUndefined()
  })
})

describe('stock mutation hooks — optimistic updates (T062)', () => {
  it('useConsumeStock decrements quantity + lots optimistically', async () => {
    // Resolve slowly so we can observe the mid-flight optimistic state.
    server.use(
      http.post(`${BASE}/stock/1/consume/`, async () => {
        await new Promise((r) => setTimeout(r, 20))
        return HttpResponse.json({
          id: 1,
          quantity: 8,
          lots: [{ id: 100, quantity: 8, expiry_date: null }],
        })
      }),
    )
    const { result, qc } = renderWith(() => useConsumeStock())
    qc.setQueryData(['stock', 1], { id: 1, quantity: 10, lots: [{ id: 100, quantity: 10, expiry_date: null }] })
    qc.setQueryData(['stock'], [{ id: 1, quantity: 10, lots: [{ id: 100, quantity: 10, expiry_date: null }] }])

    let promise
    act(() => {
      promise = result.current.mutateAsync({ stockId: 1, quantity: 2, lotSelections: [] })
    })

    // onMutate ran: cache shows 8 already, before the server responds.
    await waitFor(() => expect(qc.getQueryData(['stock', 1]).quantity).toBe(8))
    expect(qc.getQueryData(['stock', 1]).lots[0].quantity).toBe(8)

    await act(async () => {
      await promise
    })
    // Server response lands and overwrites.
    expect(qc.getQueryData(['stock', 1]).quantity).toBe(8)
  })

  it('useConsumeStock rolls back optimistic state on server error', async () => {
    server.use(http.post(`${BASE}/stock/1/consume/`, () => new HttpResponse(null, { status: 400 })))
    const { result, qc } = renderWith(() => useConsumeStock())
    const original = { id: 1, quantity: 10, lots: [{ id: 100, quantity: 10, expiry_date: null }] }
    qc.setQueryData(['stock', 1], original)
    qc.setQueryData(['stock'], [original])

    await act(async () => {
      try {
        await result.current.mutateAsync({ stockId: 1, quantity: 2, lotSelections: [] })
      } catch {
        // expected
      }
    })
    expect(qc.getQueryData(['stock', 1])).toEqual(original)
    expect(qc.getQueryData(['stock'])).toEqual([original])
  })

  it('useUpdateStock applies the patch optimistically and keeps it when queued offline', async () => {
    server.use(mockNetworkError('patch', '/stock/1/'))
    const { result, qc } = renderWith(() => useUpdateStock())
    qc.setQueryData(['stock'], [{ id: 1, name: 'Soap' }])
    qc.setQueryData(['stock', 1], { id: 1, name: 'Soap' })

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({ stockId: 1, patch: { name: 'Handsoap' } })
    })
    expect(returned).toEqual({ __queued: true })
    // The optimistic value stays because the mutation was successfully queued.
    expect(qc.getQueryData(['stock', 1])).toEqual({ id: 1, name: 'Handsoap' })
    expect(qc.getQueryData(['stock'])).toEqual([{ id: 1, name: 'Handsoap' }])
  })

  it('useUpdateStock rolls back when the server rejects with 4xx', async () => {
    server.use(http.patch(`${BASE}/stock/1/`, () => new HttpResponse(null, { status: 400 })))
    const { result, qc } = renderWith(() => useUpdateStock())
    qc.setQueryData(['stock', 1], { id: 1, name: 'Soap' })
    qc.setQueryData(['stock'], [{ id: 1, name: 'Soap' }])

    await act(async () => {
      try {
        await result.current.mutateAsync({ stockId: 1, patch: { name: 'Handsoap' } })
      } catch {
        // expected
      }
    })
    expect(qc.getQueryData(['stock', 1])).toEqual({ id: 1, name: 'Soap' })
    expect(qc.getQueryData(['stock'])).toEqual([{ id: 1, name: 'Soap' }])
  })

  it('useDeleteStock removes the item optimistically; rolls back on 4xx', async () => {
    server.use(http.delete(`${BASE}/stock/1/`, () => new HttpResponse(null, { status: 403 })))
    const { result, qc } = renderWith(() => useDeleteStock())
    qc.setQueryData(['stock'], [{ id: 1, name: 'Soap' }])
    qc.setQueryData(['stock', 1], { id: 1, name: 'Soap' })

    await act(async () => {
      try {
        await result.current.mutateAsync({ stockId: 1 })
      } catch {
        // expected
      }
    })
    expect(qc.getQueryData(['stock'])).toEqual([{ id: 1, name: 'Soap' }])
    expect(qc.getQueryData(['stock', 1])).toEqual({ id: 1, name: 'Soap' })
  })
})
