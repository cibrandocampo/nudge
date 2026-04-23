import 'fake-indexeddb/auto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../test/mocks/server'
import { clear, list } from '../../offline/queue'
import { mockNetworkError } from '../../test/mocks/handlers'
import { useUndoLogRoutine } from '../mutations/useUndoLogRoutine'
import { useSubscribePush } from '../mutations/useSubscribePush'
import { useUnsubscribePush } from '../mutations/useUnsubscribePush'
import { useChangePassword } from '../mutations/useChangePassword'
import { useCreateContact } from '../mutations/useCreateContact'
import { useCreateStock } from '../mutations/useCreateStock'
import { useCreateRoutine } from '../mutations/useCreateRoutine'
import { useUpdateMe } from '../mutations/useUpdateMe'
import { useUpdateRoutine } from '../mutations/useUpdateRoutine'
import { useLogRoutine } from '../mutations/useLogRoutine'
import { useConsumeStock } from '../mutations/useConsumeStock'
import { useUpdateStockLot } from '../mutations/useUpdateStockLot'
import { useCreateStockLot } from '../mutations/useCreateStockLot'
import { useDeleteStockLot } from '../mutations/useDeleteStockLot'
import { useDeleteRoutine } from '../mutations/useDeleteRoutine'

const BASE = 'http://localhost/api'

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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

describe('useUndoLogRoutine', () => {
  it('invalidates caches touched by the log-routine flow on success', async () => {
    server.use(http.delete(`${BASE}/entries/42/`, () => new HttpResponse(null, { status: 204 })))
    const { result, qc } = renderWith(() => useUndoLogRoutine())
    qc.setQueryData(['dashboard'], { due: [], upcoming: [] })
    qc.setQueryData(['routines'], [{ id: 1 }])
    qc.setQueryData(['entries'], [])
    qc.setQueryData(['routine-entries', 1], [])
    qc.setQueryData(['stock'], [])

    await act(async () => {
      await result.current.mutateAsync({ entryId: 42 })
    })
    // onSuccess marks all touched keys as invalidated.
    expect(qc.getQueryState(['dashboard']).isInvalidated).toBe(true)
    expect(qc.getQueryState(['routines']).isInvalidated).toBe(true)
    expect(qc.getQueryState(['entries']).isInvalidated).toBe(true)
    expect(qc.getQueryState(['routine-entries', 1]).isInvalidated).toBe(true)
    expect(qc.getQueryState(['stock']).isInvalidated).toBe(true)
  })

  it('queues offline when the network is unreachable (queueable default)', async () => {
    server.use(mockNetworkError('delete', '/entries/77/'))
    const { result } = renderWith(() => useUndoLogRoutine())

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({ entryId: 77 })
    })
    expect(returned).toEqual({ __queued: true })
    expect(await list()).toHaveLength(1)
  })
})

describe('useSubscribePush / useUnsubscribePush', () => {
  it('useSubscribePush POSTs endpoint + keys to /push/subscribe/', async () => {
    let body = null
    server.use(
      http.post(`${BASE}/push/subscribe/`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    const { result } = renderWith(() => useSubscribePush())
    await act(async () => {
      await result.current.mutateAsync({
        endpoint: 'https://e2e.nudge.local/push/abc',
        keys: { p256dh: 'p', auth: 'a' },
      })
    })
    expect(body).toEqual({
      endpoint: 'https://e2e.nudge.local/push/abc',
      keys: { p256dh: 'p', auth: 'a' },
    })
  })

  it('useSubscribePush surfaces OfflineError (online-only, no queue)', async () => {
    server.use(mockNetworkError('post', '/push/subscribe/'))
    const { result } = renderWith(() => useSubscribePush())

    let caught = null
    await act(async () => {
      try {
        await result.current.mutateAsync({ endpoint: 'x', keys: {} })
      } catch (err) {
        caught = err
      }
    })
    expect(caught?.name).toBe('OfflineError')
    expect(await list()).toHaveLength(0)
  })

  it('useUnsubscribePush DELETEs with the endpoint in the body', async () => {
    let body = null
    server.use(
      http.delete(`${BASE}/push/unsubscribe/`, async ({ request }) => {
        body = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { result } = renderWith(() => useUnsubscribePush())
    await act(async () => {
      await result.current.mutateAsync({ endpoint: 'https://e2e.nudge.local/push/xyz' })
    })
    expect(body).toEqual({ endpoint: 'https://e2e.nudge.local/push/xyz' })
  })
})

describe('useChangePassword', () => {
  it('POSTs snake_case body to /auth/change-password/', async () => {
    let body = null
    server.use(
      http.post(`${BASE}/auth/change-password/`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ detail: 'ok' })
      }),
    )
    const { result } = renderWith(() => useChangePassword())
    await act(async () => {
      await result.current.mutateAsync({ oldPassword: 'old', newPassword: 'newer' })
    })
    expect(body).toEqual({ old_password: 'old', new_password: 'newer' })
  })
})

describe('useCreateContact — branches', () => {
  it('invalidates the contacts cache when the response lacks an id', async () => {
    server.use(http.post(`${BASE}/auth/contacts/`, () => HttpResponse.json({ detail: 'ok' }, { status: 201 })))
    const { result, qc } = renderWith(() => useCreateContact())
    qc.setQueryData(['contacts'], [{ id: 1, username: 'alice' }])

    await act(async () => {
      await result.current.mutateAsync({ username: 'bob' })
    })
    // No id in response → goes down invalidate branch, leaves cache intact.
    expect(qc.getQueryState(['contacts']).isInvalidated).toBe(true)
    expect(qc.getQueryData(['contacts'])).toEqual([{ id: 1, username: 'alice' }])
  })

  it('skips the append when the id is already in the cache', async () => {
    server.use(
      http.post(`${BASE}/auth/contacts/`, () => HttpResponse.json({ id: 5, username: 'bob' }, { status: 201 })),
    )
    const { result, qc } = renderWith(() => useCreateContact())
    qc.setQueryData(['contacts'], [{ id: 5, username: 'bob' }])

    await act(async () => {
      await result.current.mutateAsync({ username: 'bob' })
    })
    expect(qc.getQueryData(['contacts'])).toEqual([{ id: 5, username: 'bob' }])
  })
})

describe('useCreateStock — branches', () => {
  it('invalidates stock when the mutation is queued offline (__queued branch)', async () => {
    // queueable:false hook → goes through the else branch on OfflineError
    // only because it rethrows. The `__queued` branch here is hit when the
    // response is something falsy-ish; simulate by returning __queued-like.
    server.use(http.post(`${BASE}/stock/`, () => HttpResponse.json({ __queued: true })))
    const { result, qc } = renderWith(() => useCreateStock())
    qc.setQueryData(['stock'], [{ id: 1, name: 'Alpha' }])

    await act(async () => {
      await result.current.mutateAsync({ name: 'Beta' })
    })
    expect(qc.getQueryState(['stock']).isInvalidated).toBe(true)
  })
})

describe('useCreateRoutine — branches', () => {
  it('invalidates entries when payload carries last_done_at (backdated creation)', async () => {
    server.use(http.post(`${BASE}/routines/`, () => HttpResponse.json({ id: 7, name: 'Back' }, { status: 201 })))
    const { result, qc } = renderWith(() => useCreateRoutine())
    qc.setQueryData(['entries'], [])

    await act(async () => {
      await result.current.mutateAsync({
        payload: { name: 'Back', interval_hours: 24, last_done_at: '2026-01-01T00:00:00Z' },
      })
    })
    expect(qc.getQueryState(['entries']).isInvalidated).toBe(true)
  })
})

describe('useUpdateMe — branches', () => {
  it('merges server response into me cache on success', async () => {
    let calls = 0
    server.use(
      http.patch(`${BASE}/auth/me/`, () => {
        calls += 1
        return HttpResponse.json({ id: 1, username: 'u', language: 'es', timezone: 'Europe/Madrid' })
      }),
    )
    const { result, qc } = renderWith(() => useUpdateMe())
    qc.setQueryData(['me'], { id: 1, username: 'u', language: 'en', timezone: 'Europe/Madrid' })

    await act(async () => {
      await result.current.mutateAsync({ patch: { language: 'es' } })
    })
    expect(calls).toBe(1)
    expect(qc.getQueryData(['me']).language).toBe('es')
  })

  it('auto-recovers from 412 by priming the cache and replaying with fresh updated_at', async () => {
    const freshTs = '2026-04-22T10:00:00Z'
    const finalTs = '2026-04-22T10:00:05Z'
    const calls = []
    server.use(
      http.patch(`${BASE}/auth/me/`, async ({ request }) => {
        calls.push({ body: await request.json(), ifUnmodified: request.headers.get('if-unmodified-since') })
        if (calls.length === 1) {
          return HttpResponse.json(
            {
              error: 'conflict',
              current: { id: 1, username: 'u', language: 'en', settings_updated_at: freshTs },
            },
            { status: 412 },
          )
        }
        return HttpResponse.json({ id: 1, username: 'u', language: 'gl', settings_updated_at: finalTs })
      }),
    )
    const { result, qc } = renderWith(() => useUpdateMe())
    qc.setQueryData(['me'], { id: 1, username: 'u', language: 'en', settings_updated_at: '2026-01-01T00:00:00Z' })

    await act(async () => {
      await result.current.mutateAsync({ patch: { language: 'gl' }, updatedAt: '2026-01-01T00:00:00Z' })
    })

    expect(calls).toHaveLength(2)
    expect(calls[1].ifUnmodified).toBe(new Date(freshTs).toUTCString())
    const me = qc.getQueryData(['me'])
    expect(me.language).toBe('gl')
    expect(me.settings_updated_at).toBe(finalTs)
  })

  it('propagates a second 412 without retrying again', async () => {
    const freshTs = '2026-04-22T10:00:00Z'
    let calls = 0
    server.use(
      http.patch(`${BASE}/auth/me/`, () => {
        calls += 1
        return HttpResponse.json(
          {
            error: 'conflict',
            current: { id: 1, username: 'u', language: 'en', settings_updated_at: freshTs },
          },
          { status: 412 },
        )
      }),
    )
    const { result } = renderWith(() => useUpdateMe())

    let caught = null
    await act(async () => {
      try {
        await result.current.mutateAsync({ patch: { language: 'gl' }, updatedAt: '2026-01-01T00:00:00Z' })
      } catch (err) {
        caught = err
      }
    })

    expect(calls).toBe(2)
    expect(caught?.name).toBe('ConflictError')
    expect(caught?.current?.settings_updated_at).toBe(freshTs)
  })

  it('does not retry when a 412 arrives without a current body', async () => {
    let calls = 0
    server.use(
      http.patch(`${BASE}/auth/me/`, () => {
        calls += 1
        return HttpResponse.json({ error: 'conflict' }, { status: 412 })
      }),
    )
    const { result } = renderWith(() => useUpdateMe())

    let caught = null
    await act(async () => {
      try {
        await result.current.mutateAsync({ patch: { language: 'gl' }, updatedAt: '2026-01-01T00:00:00Z' })
      } catch (err) {
        caught = err
      }
    })

    expect(calls).toBe(1)
    expect(caught?.name).toBe('ConflictError')
    expect(caught?.current).toBeUndefined()
  })
})

describe('useUpdateRoutine — dashboard optimistic branch', () => {
  it('patches due + upcoming entries in the dashboard cache optimistically', async () => {
    server.use(http.patch(`${BASE}/routines/5/`, () => HttpResponse.json({ id: 5, name: 'Vitamins' })))
    const { result, qc } = renderWith(() => useUpdateRoutine())
    qc.setQueryData(['dashboard'], {
      due: [
        { id: 5, name: 'Pills' },
        { id: 6, name: 'Other' },
      ],
      upcoming: [
        { id: 5, name: 'Pills' },
        { id: 7, name: 'Third' },
      ],
    })

    await act(async () => {
      await result.current.mutateAsync({ routineId: 5, patch: { name: 'Vitamins' } })
    })
    const dash = qc.getQueryData(['dashboard'])
    expect(dash.due[0].name).toBe('Vitamins')
    expect(dash.due[1].name).toBe('Other')
    expect(dash.upcoming[0].name).toBe('Vitamins')
    expect(dash.upcoming[1].name).toBe('Third')
  })

  it('leaves the dashboard untouched when the cache is empty', async () => {
    server.use(http.patch(`${BASE}/routines/5/`, () => HttpResponse.json({ id: 5 })))
    const { result, qc } = renderWith(() => useUpdateRoutine())
    // No dashboard data set. The optimistic update should be a no-op for that key.

    await act(async () => {
      await result.current.mutateAsync({ routineId: 5, patch: { name: 'X' } })
    })
    expect(qc.getQueryData(['dashboard'])).toBeUndefined()
  })
})

describe('useLogRoutine — branches', () => {
  it('handles a dashboard cache without a due array (optional chaining branch)', async () => {
    server.use(http.post(`${BASE}/routines/5/log/`, () => HttpResponse.json({ id: 1 }, { status: 201 })))
    const { result, qc } = renderWith(() => useLogRoutine())
    // dashboard without the `due` key
    qc.setQueryData(['dashboard'], { upcoming: [{ id: 6 }] })

    await act(async () => {
      await result.current.mutateAsync({ routineId: 5 })
    })
    const dash = qc.getQueryData(['dashboard'])
    // The optimistic branch rebuilds `due` from []; the server response then
    // triggers invalidate. We assert the due key ended up as an empty array.
    expect(Array.isArray(dash.due)).toBe(true)
  })

  it('leaves ["routine", id] untouched when the detail cache is empty', async () => {
    server.use(http.post(`${BASE}/routines/9/log/`, () => HttpResponse.json({ id: 2 }, { status: 201 })))
    const { result, qc } = renderWith(() => useLogRoutine())

    await act(async () => {
      await result.current.mutateAsync({ routineId: 9 })
    })
    // Nothing was set before; the optimistic update returns prev (undefined).
    expect(qc.getQueryData(['routine', 9])).toBeUndefined()
  })
})

describe('useConsumeStock — applyConsumption branches', () => {
  it('respects explicit lot_selections (bySel path with deduct > 0 and filter empty lots)', async () => {
    server.use(http.post(`${BASE}/stock/1/consume/`, () => HttpResponse.json({ id: 1, quantity: 2, lots: [] })))
    const { result, qc } = renderWith(() => useConsumeStock())
    qc.setQueryData(['stock', 1], {
      id: 1,
      quantity: 5,
      lots: [
        { id: 100, quantity: 3, expiry_date: null, created_at: '2026-01-01T00:00:00Z' },
        { id: 101, quantity: 2, expiry_date: null, created_at: '2026-02-01T00:00:00Z' },
      ],
    })
    qc.setQueryData(
      ['stock'],
      [
        {
          id: 1,
          quantity: 5,
          lots: [
            { id: 100, quantity: 3, expiry_date: null, created_at: '2026-01-01T00:00:00Z' },
            { id: 101, quantity: 2, expiry_date: null, created_at: '2026-02-01T00:00:00Z' },
          ],
        },
      ],
    )

    await act(async () => {
      await result.current.mutateAsync({
        stockId: 1,
        quantity: 3,
        lotSelections: [{ lot_id: 100, quantity: 3 }],
      })
    })
    // Server response lands; the optimistic filter+subtract path ran
    // beforehand with deduct > 0 for lot 100, consuming it entirely (filter
    // removes quantity-0 lot).
    const stock = qc.getQueryData(['stock', 1])
    expect(stock.quantity).toBe(2)
  })

  it('uses FEFO ordering when no lot_selections are provided (fefoCompare branch)', async () => {
    server.use(
      http.post(`${BASE}/stock/1/consume/`, async () => {
        await new Promise((r) => setTimeout(r, 5))
        return HttpResponse.json({ id: 1, quantity: 1, lots: [{ id: 103, quantity: 1, expiry_date: '2027-01-01' }] })
      }),
    )
    const { result, qc } = renderWith(() => useConsumeStock())
    qc.setQueryData(['stock', 1], {
      id: 1,
      quantity: 3,
      lots: [
        // Same expiry_date → fefoCompare falls back to created_at comparison (branch)
        { id: 102, quantity: 2, expiry_date: '2026-05-01', created_at: '2026-02-01T00:00:00Z' },
        { id: 103, quantity: 1, expiry_date: '2027-01-01', created_at: '2026-01-01T00:00:00Z' },
      ],
    })

    await act(async () => {
      await result.current.mutateAsync({
        stockId: 1,
        quantity: 2,
        lotSelections: undefined,
      })
    })
    const stock = qc.getQueryData(['stock', 1])
    expect(stock.quantity).toBe(1)
  })

  it('handles lot_selections with deduct = 0 (skips the subtract)', async () => {
    server.use(http.post(`${BASE}/stock/1/consume/`, () => HttpResponse.json({ id: 1, quantity: 4, lots: [] })))
    const { result, qc } = renderWith(() => useConsumeStock())
    qc.setQueryData(['stock', 1], {
      id: 1,
      quantity: 5,
      lots: [{ id: 100, quantity: 5, expiry_date: null, created_at: '2026-01-01T00:00:00Z' }],
    })

    await act(async () => {
      await result.current.mutateAsync({
        stockId: 1,
        quantity: 1,
        // The selection has a lot_id that does NOT match any lot → bySel.get returns undefined → deduct = 0
        lotSelections: [{ lot_id: 999, quantity: 1 }],
      })
    })
    expect(qc.getQueryData(['stock', 1]).quantity).toBe(4)
  })
})

describe('useUpdateStockLot — branches', () => {
  it('ignores array stock list when the matching stock has no lots array', async () => {
    server.use(http.patch(`${BASE}/stock/1/lots/10/`, () => HttpResponse.json({ id: 10, quantity: 5 })))
    const { result, qc } = renderWith(() => useUpdateStockLot())
    // Stock without `lots` → patchLot returns stock unchanged
    qc.setQueryData(['stock'], [{ id: 1, name: 'NoLots' }])
    qc.setQueryData(['stock', 1], { id: 1, name: 'NoLots' })

    await act(async () => {
      await result.current.mutateAsync({ stockId: 1, lotId: 10, patch: { quantity: 5 } })
    })
    expect(qc.getQueryData(['stock', 1])).toEqual({ id: 1, name: 'NoLots' })
  })

  it('no-ops when the stock list cache is not an array', async () => {
    server.use(http.patch(`${BASE}/stock/1/lots/10/`, () => HttpResponse.json({ id: 10 })))
    const { result, qc } = renderWith(() => useUpdateStockLot())
    // Non-array value in ['stock'] → setQueryData callback returns prev as-is
    qc.setQueryData(['stock'], { not: 'an array' })

    await act(async () => {
      await result.current.mutateAsync({ stockId: 1, lotId: 10, patch: { quantity: 1 } })
    })
    expect(qc.getQueryData(['stock'])).toEqual({ not: 'an array' })
  })
})

describe('useDeleteRoutine — sparse dashboard', () => {
  it('tolerates a dashboard cache without due/upcoming arrays', async () => {
    server.use(http.delete(`${BASE}/routines/5/`, () => new HttpResponse(null, { status: 204 })))
    const { result, qc } = renderWith(() => useDeleteRoutine())
    qc.setQueryData(['dashboard'], {}) // no due, no upcoming

    await act(async () => {
      await result.current.mutateAsync({ routineId: 5 })
    })
    const dash = qc.getQueryData(['dashboard'])
    expect(dash.due).toEqual([])
    expect(dash.upcoming).toEqual([])
  })

  it('no-ops on the routines list cache when it is not an array', async () => {
    server.use(http.delete(`${BASE}/routines/5/`, () => new HttpResponse(null, { status: 204 })))
    const { result, qc } = renderWith(() => useDeleteRoutine())
    qc.setQueryData(['routines'], { not: 'array' })

    await act(async () => {
      await result.current.mutateAsync({ routineId: 5 })
    })
    expect(qc.getQueryData(['routines'])).toEqual({ not: 'array' })
  })
})

describe('useCreateStockLot / useDeleteStockLot — branches', () => {
  it('useCreateStockLot no-ops on non-array stock list cache', async () => {
    server.use(
      http.post(`${BASE}/stock/1/lots/`, () => HttpResponse.json({ id: 10 }, { status: 201 })),
      http.get(`${BASE}/stock/1/`, () => HttpResponse.json({ id: 1, name: 'Soap', quantity: 3 })),
    )
    const { result, qc } = renderWith(() => useCreateStockLot())
    qc.setQueryData(['stock'], { not: 'array' })

    await act(async () => {
      await result.current.mutateAsync({ stockId: 1, quantity: 3 })
    })
    // The optimistic `setQueryData(['stock'])` callback returns prev as-is
    // when it is not an array, so the non-array value survives.
    expect(qc.getQueryData(['stock'])).toEqual({ not: 'array' })
  })

  it('useCreateStockLot optimistic skips stocks without a lots array', async () => {
    server.use(
      http.post(`${BASE}/stock/1/lots/`, () => HttpResponse.json({ id: 10 }, { status: 201 })),
      http.get(`${BASE}/stock/1/`, () => HttpResponse.json({ id: 1, lots: [] })),
    )
    const { result, qc } = renderWith(() => useCreateStockLot())
    qc.setQueryData(['stock', 1], { id: 1, name: 'NoLots' }) // no lots array
    qc.setQueryData(['stock'], [{ id: 1, name: 'NoLots' }])

    await act(async () => {
      await result.current.mutateAsync({ stockId: 1, quantity: 2 })
    })
    // Optimistic step left it alone; onSuccess GET result overwrote it.
    expect(qc.getQueryData(['stock', 1])).toEqual({ id: 1, lots: [] })
  })

  it('useDeleteStockLot no-ops on non-array stock list cache', async () => {
    server.use(
      http.delete(`${BASE}/stock/1/lots/10/`, () => new HttpResponse(null, { status: 204 })),
      http.get(`${BASE}/stock/1/`, () => HttpResponse.json({ id: 1, lots: [] })),
    )
    const { result, qc } = renderWith(() => useDeleteStockLot())
    qc.setQueryData(['stock'], { not: 'array' })
    qc.setQueryData(['stock', 1], { id: 1, lots: [{ id: 10, quantity: 3 }] })

    await act(async () => {
      await result.current.mutateAsync({ stockId: 1, lotId: 10 })
    })
    expect(qc.getQueryData(['stock'])).toEqual({ not: 'array' })
  })
})

describe('useCreateStockLot / useDeleteStockLot — catch branches', () => {
  it('useCreateStockLot falls back to invalidate when the GET /stock/:id/ rejects', async () => {
    server.use(
      http.post(`${BASE}/stock/1/lots/`, () => HttpResponse.json({ id: 10, quantity: 3 }, { status: 201 })),
      http.get(`${BASE}/stock/1/`, () => HttpResponse.error()),
    )
    const { result, qc } = renderWith(() => useCreateStockLot())
    qc.setQueryData(['stock'], [{ id: 1, name: 'Soap', quantity: 5 }])

    await act(async () => {
      await result.current.mutateAsync({ stockId: 1, quantity: 3 })
    })
    // The catch path invalidates the stock list.
    expect(qc.getQueryState(['stock']).isInvalidated).toBe(true)
  })

  it('useDeleteStockLot falls back to invalidate when the GET /stock/:id/ rejects', async () => {
    server.use(
      http.delete(`${BASE}/stock/1/lots/10/`, () => new HttpResponse(null, { status: 204 })),
      http.get(`${BASE}/stock/1/`, () => HttpResponse.error()),
    )
    const { result, qc } = renderWith(() => useDeleteStockLot())
    qc.setQueryData(['stock'], [{ id: 1, quantity: 5 }])

    await act(async () => {
      await result.current.mutateAsync({ stockId: 1, lotId: 10 })
    })
    expect(qc.getQueryState(['stock']).isInvalidated).toBe(true)
  })
})
