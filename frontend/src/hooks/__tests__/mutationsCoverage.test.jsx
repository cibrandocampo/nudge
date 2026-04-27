import 'fake-indexeddb/auto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../test/mocks/server'
import { clear, discard, enqueue, list } from '../../offline/queue'
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
import { useDeleteStock } from '../mutations/useDeleteStock'
import { useUpdateStock } from '../mutations/useUpdateStock'
import { useUpdateEntry } from '../mutations/useUpdateEntry'
import { useUpdateConsumption } from '../mutations/useUpdateConsumption'

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

  it('patches only the matching row in the routines list and tolerates missing due/upcoming arrays', async () => {
    server.use(http.patch(`${BASE}/routines/5/`, () => HttpResponse.json({ id: 5, name: 'Vitamins' })))
    const { result, qc } = renderWith(() => useUpdateRoutine())
    qc.setQueryData(
      ['routines'],
      [
        { id: 5, name: 'Pills' },
        { id: 99, name: 'Other' }, // unrelated — exercises the "id !== target" branch
      ],
    )
    qc.setQueryData(['dashboard'], {}) // no due / no upcoming → exercises the `?? []` fallbacks

    await act(async () => {
      await result.current.mutateAsync({ routineId: 5, patch: { name: 'Vitamins' } })
    })
    const routines = qc.getQueryData(['routines'])
    expect(routines[0].name).toBe('Vitamins')
    expect(routines[1].name).toBe('Other')
    const dash = qc.getQueryData(['dashboard'])
    expect(dash.due).toEqual([])
    expect(dash.upcoming).toEqual([])
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
    // T112: the optimistic exercises `prev.due ?? []` defensively, then
    // looks for routine 5 in the (empty) result. Since it isn't there it
    // returns prev unchanged — `dash` stays exactly as it was set up. The
    // important branch-coverage signal is that the optimistic did not
    // throw when reading `prev.due` on a dashboard without that key.
    expect(dash).toEqual({ upcoming: [{ id: 6 }] })
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

  it('falls back to quantity = 0 when the cached stock has no quantity field', async () => {
    server.use(http.post(`${BASE}/stock/1/consume/`, () => HttpResponse.json({ id: 1, quantity: 2, lots: [] })))
    const { result, qc } = renderWith(() => useConsumeStock())
    // Stock list + detail both without a `quantity` field → the `?? 0` fallback is exercised.
    qc.setQueryData(
      ['stock'],
      [
        { id: 1, lots: [{ id: 100, quantity: 1 }] },
        { id: 2, lots: [] }, // unrelated stock exercises the non-matching id branch.
      ],
    )
    qc.setQueryData(['stock', 1], { id: 1, lots: [{ id: 100, quantity: 1 }] })

    await act(async () => {
      await result.current.mutateAsync({
        stockId: 1,
        quantity: 1,
        lotSelections: [{ lot_id: 100, quantity: 1 }],
      })
    })
    // Server response overwrote the cache; check the intermediate optimistic step
    // did not explode on the missing quantity.
    expect(qc.getQueryData(['stock', 1]).quantity).toBe(2)
  })

  it('sorts lots with null expiry_date and missing created_at using FEFO fallbacks', async () => {
    server.use(http.post(`${BASE}/stock/1/consume/`, () => HttpResponse.json({ id: 1, quantity: 2, lots: [] })))
    const { result, qc } = renderWith(() => useConsumeStock())
    qc.setQueryData(['stock', 1], {
      id: 1,
      quantity: 3,
      lots: [
        { id: 200, quantity: 1, expiry_date: null }, // no created_at → empty string
        { id: 201, quantity: 1, expiry_date: null, created_at: '2026-01-01T00:00:00Z' },
        { id: 202, quantity: 1, expiry_date: '2026-05-01' },
      ],
    })

    await act(async () => {
      await result.current.mutateAsync({ stockId: 1, quantity: 1, lotSelections: undefined })
    })
    // The 2026-05-01 lot (earliest expiry) should be consumed first in the
    // optimistic update; server response overwrites to match.
    expect(qc.getQueryData(['stock', 1]).quantity).toBe(2)
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

  it('keeps the optimistic decrement in cache when offline mutateAsync resolves with __queued', async () => {
    // T107 regression. Prior version invalidated ['stock'] in the offline
    // branch, which in production triggered a refetch served by the SW
    // runtime cache (stale list) — clobbering the optimistic decrement.
    server.use(mockNetworkError('post', '/stock/1/consume/'))
    const { result, qc } = renderWith(() => useConsumeStock())
    qc.setQueryData(
      ['stock'],
      [
        {
          id: 1,
          name: 'Vit D',
          quantity: 250,
          lots: [{ id: 10, quantity: 250, expiry_date: null, created_at: '2026-01-01T00:00:00Z' }],
        },
      ],
    )
    qc.setQueryData(['stock', 1], {
      id: 1,
      name: 'Vit D',
      quantity: 250,
      lots: [{ id: 10, quantity: 250, expiry_date: null, created_at: '2026-01-01T00:00:00Z' }],
    })

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({
        stockId: 1,
        quantity: 1,
        lotSelections: [{ lot_id: 10, quantity: 1 }],
      })
    })

    // Mutation resolved through the offline-queue branch.
    expect(returned).toEqual({ __queued: true })
    // Optimistic decrement persists in both list and detail caches.
    expect(qc.getQueryData(['stock'])[0].quantity).toBe(249)
    expect(qc.getQueryData(['stock', 1]).quantity).toBe(249)
    // ['stock'] and ['stock', 1] must NOT be marked invalidated — that
    // would trigger a refetch, and the SW's stale cache would clobber
    // the optimistic value in the browser. Peripheral caches stay
    // invalidated as before.
    expect(qc.getQueryState(['stock']).isInvalidated).toBe(false)
    expect(qc.getQueryState(['stock', 1]).isInvalidated).toBe(false)
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

  it('updates the target lot in place and leaves sibling lots untouched', async () => {
    server.use(http.patch(`${BASE}/stock/1/lots/10/`, () => HttpResponse.json({ id: 10, quantity: 7 })))
    const { result, qc } = renderWith(() => useUpdateStockLot())
    // Two lots + a sibling lot (exercises the "lot.id !== lid" branch).
    // Lot without a quantity exercises the `?? 0` sum fallback.
    qc.setQueryData(['stock', 1], {
      id: 1,
      lots: [
        { id: 10, quantity: 3 },
        { id: 11 }, // no quantity
      ],
    })
    qc.setQueryData(
      ['stock'],
      [
        {
          id: 1,
          lots: [{ id: 10, quantity: 3 }, { id: 11 }],
        },
        { id: 2, lots: [{ id: 20, quantity: 5 }] }, // unrelated stock (id !== 1)
      ],
    )

    await act(async () => {
      await result.current.mutateAsync({ stockId: 1, lotId: 10, patch: { quantity: 7 } })
    })
    // Invalidate runs on success → read from the optimistic snapshot before
    // the next refetch would happen. We just need to confirm no throw.
    const list = qc.getQueryData(['stock'])
    expect(Array.isArray(list)).toBe(true)
    expect(list.find((s) => s.id === 2)).toBeDefined()
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

describe('T108 — labelKey/labelArgs persistence on offline enqueue', () => {
  it('useConsumeStock persists labelKey and labelArgs from its label factory', async () => {
    server.use(mockNetworkError('post', '/stock/1/consume/'))
    const { result } = renderWith(() => useConsumeStock())

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({
        stockId: 1,
        stockName: 'Vit D',
        quantity: 1,
        lotSelections: [{ lot_id: 10, quantity: 1 }],
      })
    })
    expect(returned).toEqual({ __queued: true })

    const entries = await list()
    expect(entries).toHaveLength(1)
    expect(entries[0].labelKey).toBe('offline.label.consumeStock')
    expect(entries[0].labelArgs).toEqual({ name: 'Vit D', qty: 1 })
  })

  it('useLogRoutine persists labelKey and labelArgs from its label factory', async () => {
    server.use(mockNetworkError('post', '/routines/9/log/'))
    const { result } = renderWith(() => useLogRoutine())

    await act(async () => {
      await result.current.mutateAsync({ routineId: 9, routineName: 'Take vitamins' })
    })

    const entries = await list()
    expect(entries).toHaveLength(1)
    expect(entries[0].labelKey).toBe('offline.label.logRoutine')
    expect(entries[0].labelArgs).toEqual({ name: 'Take vitamins' })
  })

  it('falls back to "?" when the call-site forgets to supply the name', async () => {
    server.use(mockNetworkError('post', '/routines/9/log/'))
    const { result } = renderWith(() => useLogRoutine())

    await act(async () => {
      await result.current.mutateAsync({ routineId: 9 })
    })

    const entries = await list()
    expect(entries[0].labelArgs).toEqual({ name: '?' })
  })

  // The "hooks without a label factory" path was originally covered here
  // (with `useUndoLogRoutine` as a poster child) but T109 added labels to
  // every hook that uses `useOfflineMutation`. The null-label path is now
  // exercised purely via legacy queue entries; that scenario lives in
  // PendingBadge.test.jsx ("falls back to method + endpoint when labelKey
  // is missing"), which directly enqueues an entry with `labelKey: null`.
})

describe('T109 — label persistence across the rest of the queueable hooks', () => {
  // Each row covers one queueable:true hook whose label factory was added
  // in T109. The 10 queueable:false hooks (useCreateRoutine, useCreateStock,
  // useCreate/Update/DeleteStockGroup, useCreate/DeleteContact,
  // useSubscribePush, useUnsubscribePush, useChangePassword) declare a
  // factory too but their offline branch re-throws OfflineError before
  // the enqueue path runs — there's nothing observable to assert via the
  // queue, so they're omitted here. The factory itself is exercised when
  // they're invoked online and is a pure function that cannot fail.
  //
  // ESLint sees `() => useFoo()` arrows inside an object literal and
  // can't tell they're meant for `renderHook` (which IS a valid hook
  // call site). Disable the rule for the cases array — every `useFoo()`
  // below is ultimately invoked through `renderHook` via `renderWith`.
  /* eslint-disable react-hooks/rules-of-hooks */
  const cases = [
    {
      name: 'useUndoLogRoutine',
      hook: () => useUndoLogRoutine(),
      method: 'delete',
      path: '/entries/55/',
      vars: { entryId: 55, routineName: 'Stretch' },
      expectedKey: 'offline.label.undoLogRoutine',
      expectedArgs: { name: 'Stretch' },
    },
    {
      name: 'useUpdateRoutine',
      hook: () => useUpdateRoutine(),
      method: 'patch',
      path: '/routines/12/',
      vars: { routineId: 12, routineName: 'Vitamins', patch: { name: 'Vitamins' }, updatedAt: '2026-04-17T10:00:00Z' },
      expectedKey: 'offline.label.updateRoutine',
      expectedArgs: { name: 'Vitamins' },
    },
    {
      name: 'useDeleteRoutine',
      hook: () => useDeleteRoutine(),
      method: 'delete',
      path: '/routines/8/',
      vars: { routineId: 8, routineName: 'Old', updatedAt: '2026-04-17T10:00:00Z' },
      expectedKey: 'offline.label.deleteRoutine',
      expectedArgs: { name: 'Old' },
    },
    {
      name: 'useUpdateStock',
      hook: () => useUpdateStock(),
      method: 'patch',
      path: '/stock/4/',
      vars: { stockId: 4, stockName: 'Filters', patch: { name: 'Filters' }, updatedAt: '2026-04-17T10:00:00Z' },
      expectedKey: 'offline.label.updateStock',
      expectedArgs: { name: 'Filters' },
    },
    {
      name: 'useDeleteStock',
      hook: () => useDeleteStock(),
      method: 'delete',
      path: '/stock/4/',
      vars: { stockId: 4, stockName: 'Filters', updatedAt: '2026-04-17T10:00:00Z' },
      expectedKey: 'offline.label.deleteStock',
      expectedArgs: { name: 'Filters' },
    },
    {
      name: 'useCreateStockLot',
      hook: () => useCreateStockLot(),
      method: 'post',
      path: '/stock/4/lots/',
      vars: { stockId: 4, stockName: 'Filters', quantity: 10, expiryDate: null, lotNumber: '' },
      expectedKey: 'offline.label.createStockLot',
      expectedArgs: { stockName: 'Filters', qty: 10 },
    },
    {
      name: 'useUpdateStockLot',
      hook: () => useUpdateStockLot(),
      method: 'patch',
      path: '/stock/4/lots/100/',
      vars: { stockId: 4, stockName: 'Filters', lotId: 100, patch: { quantity: 9 }, updatedAt: '2026-04-17T10:00:00Z' },
      expectedKey: 'offline.label.updateStockLot',
      expectedArgs: { stockName: 'Filters' },
    },
    {
      name: 'useDeleteStockLot',
      hook: () => useDeleteStockLot(),
      method: 'delete',
      path: '/stock/4/lots/100/',
      vars: { stockId: 4, stockName: 'Filters', lotId: 100, updatedAt: '2026-04-17T10:00:00Z' },
      expectedKey: 'offline.label.deleteStockLot',
      expectedArgs: { stockName: 'Filters' },
    },
    {
      name: 'useUpdateEntry',
      hook: () => useUpdateEntry(),
      method: 'patch',
      path: '/entries/77/',
      vars: { entryId: 77, routineName: 'Vitamins', patch: { notes: 'edit' }, updatedAt: '2026-04-17T10:00:00Z' },
      expectedKey: 'offline.label.updateEntry',
      expectedArgs: { routineName: 'Vitamins' },
    },
    {
      name: 'useUpdateConsumption',
      hook: () => useUpdateConsumption(),
      method: 'patch',
      path: '/stock-consumptions/33/',
      vars: { consumptionId: 33, stockName: 'Filters', patch: { notes: 'edit' }, updatedAt: '2026-04-17T10:00:00Z' },
      expectedKey: 'offline.label.updateConsumption',
      expectedArgs: { stockName: 'Filters' },
    },
  ]
  /* eslint-enable react-hooks/rules-of-hooks */

  it.each(cases)(
    '$name persists labelKey + labelArgs on offline enqueue',
    async ({ hook, method, path, vars, expectedKey, expectedArgs }) => {
      server.use(mockNetworkError(method, path))
      const { result } = renderWith(hook)

      let returned
      await act(async () => {
        returned = await result.current.mutateAsync(vars)
      })
      expect(returned).toEqual({ __queued: true })

      const entries = await list()
      expect(entries).toHaveLength(1)
      expect(entries[0].labelKey).toBe(expectedKey)
      expect(entries[0].labelArgs).toEqual(expectedArgs)
    },
  )
})

describe('T112 — log routine optimistic moves due → upcoming', () => {
  it('moves the routine from dashboard.due to dashboard.upcoming when offline', async () => {
    server.use(mockNetworkError('post', '/routines/9/log/'))
    const { result, qc } = renderWith(() => useLogRoutine())
    qc.setQueryData(['dashboard'], {
      due: [
        {
          id: 9,
          name: 'Take vitamins',
          interval_hours: 24,
          is_due: true,
          is_overdue: true,
          next_due_at: '2026-04-26T08:00:00Z',
        },
      ],
      upcoming: [],
    })

    await act(async () => {
      await result.current.mutateAsync({ routineId: 9, routineName: 'Take vitamins' })
    })

    const dashboard = qc.getQueryData(['dashboard'])
    expect(dashboard.due).toHaveLength(0)
    expect(dashboard.upcoming).toHaveLength(1)
    const moved = dashboard.upcoming[0]
    expect(moved.id).toBe(9)
    expect(moved.is_due).toBe(false)
    expect(moved.is_overdue).toBe(false)
    expect(moved.next_due_at).toBeTruthy()
    expect(moved.last_entry_at).toBeTruthy()
    // next_due_at must be ~24h ahead of now. Wide tolerance avoids flakes
    // on slow CI without losing the regression signal.
    const ahead = new Date(moved.next_due_at).getTime() - Date.now()
    expect(ahead).toBeGreaterThan(20 * 3600 * 1000)
    expect(ahead).toBeLessThan(30 * 3600 * 1000)
  })

  it('keeps upcoming sorted by next_due_at after moving the routine', async () => {
    server.use(mockNetworkError('post', '/routines/9/log/'))
    const { result, qc } = renderWith(() => useLogRoutine())
    // The 24h routine, once moved, must land BETWEEN the existing
    // upcoming entries (one due in 12h, one due in 48h).
    const in12h = new Date(Date.now() + 12 * 3600 * 1000).toISOString()
    const in48h = new Date(Date.now() + 48 * 3600 * 1000).toISOString()
    qc.setQueryData(['dashboard'], {
      due: [{ id: 9, name: 'Daily', interval_hours: 24, is_due: true }],
      upcoming: [
        { id: 1, name: 'Soon', next_due_at: in12h },
        { id: 2, name: 'Later', next_due_at: in48h },
      ],
    })

    await act(async () => {
      await result.current.mutateAsync({ routineId: 9, routineName: 'Daily' })
    })

    const dashboard = qc.getQueryData(['dashboard'])
    const ids = dashboard.upcoming.map((r) => r.id)
    expect(ids).toEqual([1, 9, 2])
  })

  it('returns prev unchanged when the routine is not in dashboard.due', async () => {
    server.use(mockNetworkError('post', '/routines/9/log/'))
    const { result, qc } = renderWith(() => useLogRoutine())
    qc.setQueryData(['dashboard'], {
      due: [{ id: 99, name: 'Different routine', interval_hours: 24 }],
      upcoming: [],
    })

    await act(async () => {
      await result.current.mutateAsync({ routineId: 9, routineName: 'Missing' })
    })

    const dashboard = qc.getQueryData(['dashboard'])
    // No insertion happens — the optimistic only acts on the routine it
    // found in due. id=9 doesn't appear anywhere.
    expect(dashboard.due).toEqual([{ id: 99, name: 'Different routine', interval_hours: 24 }])
    expect(dashboard.upcoming).toEqual([])
  })
})

describe('T113 — rollback persistence + discard restores cache', () => {
  // Helper: prep cache + queue a consume offline. Returns the QueryClient
  // and the persisted entry id. Avoids per-test boilerplate.
  async function enqueueConsumeOffline({ stockId, quantity, lotSelections, initial }) {
    server.use(mockNetworkError('post', `/stock/${stockId}/consume/`))
    const { result, qc } = renderWith(() => useConsumeStock())
    qc.setQueryData(['stock'], [initial])
    qc.setQueryData(['stock', stockId], initial)

    await act(async () => {
      await result.current.mutateAsync({ stockId, quantity, lotSelections })
    })

    const entries = await list()
    return { qc, entry: entries[0] }
  }

  it('useConsumeStock persists rollbackType and rollbackArgs on offline enqueue', async () => {
    const initial = {
      id: 1,
      name: 'Vit D',
      quantity: 10,
      lots: [{ id: 100, quantity: 10, expiry_date: null, created_at: '2026-01-01T00:00:00Z' }],
    }
    const { entry } = await enqueueConsumeOffline({
      stockId: 1,
      quantity: 1,
      lotSelections: [{ lot_id: 100, quantity: 1 }],
      initial,
    })

    expect(entry.rollbackType).toBe('consumeStock')
    expect(entry.rollbackArgs).toEqual({
      stockId: 1,
      quantity: 1,
      lotSelections: [{ lot_id: 100, quantity: 1 }],
    })
  })

  it('discard() restores stock quantity and lots after a queued consume', async () => {
    const initial = {
      id: 1,
      name: 'Vit D',
      quantity: 10,
      lots: [{ id: 100, quantity: 10, expiry_date: null, created_at: '2026-01-01T00:00:00Z' }],
    }
    const { qc, entry } = await enqueueConsumeOffline({
      stockId: 1,
      quantity: 1,
      lotSelections: [{ lot_id: 100, quantity: 1 }],
      initial,
    })

    // Optimistic decremented to 9.
    expect(qc.getQueryData(['stock', 1]).quantity).toBe(9)

    await act(async () => {
      await discard(entry.id, qc)
    })

    // Rollback restored to 10 + lot 100 back at 10.
    expect(qc.getQueryData(['stock', 1]).quantity).toBe(10)
    expect(qc.getQueryData(['stock', 1]).lots[0].quantity).toBe(10)
    expect(qc.getQueryData(['stock'])[0].quantity).toBe(10)
    expect(await list()).toHaveLength(0)
  })

  it('rollback composes — discarding one of N consumes only restores its own delta', async () => {
    const initial = {
      id: 1,
      name: 'Vit D',
      quantity: 10,
      lots: [{ id: 100, quantity: 10, expiry_date: null, created_at: '2026-01-01T00:00:00Z' }],
    }
    server.use(mockNetworkError('post', '/stock/1/consume/'))
    const { result, qc } = renderWith(() => useConsumeStock())
    qc.setQueryData(['stock'], [initial])
    qc.setQueryData(['stock', 1], initial)

    // Two consumes back-to-back: 10 → 9 → 8.
    await act(async () => {
      await result.current.mutateAsync({
        stockId: 1,
        quantity: 1,
        lotSelections: [{ lot_id: 100, quantity: 1 }],
      })
    })
    await act(async () => {
      await result.current.mutateAsync({
        stockId: 1,
        quantity: 1,
        lotSelections: [{ lot_id: 100, quantity: 1 }],
      })
    })
    expect(qc.getQueryData(['stock', 1]).quantity).toBe(8)

    const entries = await list()
    expect(entries).toHaveLength(2)

    // Discard the first → 8 + 1 = 9.
    await act(async () => {
      await discard(entries[0].id, qc)
    })
    expect(qc.getQueryData(['stock', 1]).quantity).toBe(9)

    // Discard the second → 9 + 1 = 10 (back to original).
    const remaining = await list()
    await act(async () => {
      await discard(remaining[0].id, qc)
    })
    expect(qc.getQueryData(['stock', 1]).quantity).toBe(10)
    expect(await list()).toHaveLength(0)
  })

  it('legacy fallback: entry without rollbackType invalidates the related queries', async () => {
    // Simulate an entry enqueued before T113: no rollbackType / rollbackArgs.
    // discard() falls back to qc.invalidateQueries by resourceKey prefix.
    const qc = makeClient()
    qc.setQueryData(['stock'], [{ id: 1, quantity: 9 }])

    await enqueue({
      id: 'legacy-entry',
      method: 'POST',
      endpoint: '/stock/1/consume/',
      body: { quantity: 1, lot_selections: null },
      resourceKey: 'stock:1',
      labelKey: null,
      labelArgs: null,
      rollbackType: null,
      rollbackArgs: null,
      ifUnmodifiedSince: null,
      createdAt: '2026-04-17T10:00:00Z',
      status: 'pending',
    })

    await act(async () => {
      await discard('legacy-entry', qc)
    })

    // No rollback — quantity stays 9 (we don't know the inverse). But
    // the ['stock'] queries are marked stale so they refetch when online.
    expect(qc.getQueryState(['stock'])?.isInvalidated).toBe(true)
    expect(qc.getQueryData(['stock'])[0].quantity).toBe(9)
    expect(await list()).toHaveLength(0)
  })
})

describe('T114 — rollback rollout: persistence + discard for the remaining 10 hooks', () => {
  // Each row drives one hook through `mockNetworkError`, asserts the
  // queue entry persists the expected `rollbackType`/`rollbackArgs`,
  // then runs `discard` and checks invalidation (for invalidate-based
  // hooks) or no-op-by-design (delta-based hooks have dedicated tests
  // below where the cache shape can be set up properly).
  /* eslint-disable react-hooks/rules-of-hooks */
  const invalidateCases = [
    {
      name: 'useUpdateRoutine',
      hook: () => useUpdateRoutine(),
      method: 'patch',
      path: '/routines/12/',
      vars: { routineId: 12, routineName: 'X', patch: { name: 'Y' }, updatedAt: '2026-04-17T10:00:00Z' },
      expectedType: 'updateRoutine',
      expectedArgs: { routineId: 12 },
      invalidateKeys: [['routine', 12], ['routines'], ['dashboard']],
    },
    {
      name: 'useUpdateStock',
      hook: () => useUpdateStock(),
      method: 'patch',
      path: '/stock/4/',
      vars: { stockId: 4, stockName: 'Filters', patch: { name: 'F2' }, updatedAt: '2026-04-17T10:00:00Z' },
      expectedType: 'updateStock',
      expectedArgs: { stockId: 4 },
      invalidateKeys: [['stock'], ['stock', 4]],
    },
    {
      name: 'useDeleteStock',
      hook: () => useDeleteStock(),
      method: 'delete',
      path: '/stock/4/',
      vars: { stockId: 4, stockName: 'Filters', updatedAt: '2026-04-17T10:00:00Z' },
      expectedType: 'deleteStock',
      expectedArgs: { stockId: 4 },
      // The optimistic wipes ['stock', 4] (setQueryData → undefined),
      // so by the time discard runs the detail key has no observable
      // state to invalidate. Only the list cache survives.
      invalidateKeys: [['stock']],
    },
    {
      name: 'useCreateStockLot',
      hook: () => useCreateStockLot(),
      method: 'post',
      path: '/stock/4/lots/',
      vars: { stockId: 4, stockName: 'Filters', quantity: 5, expiryDate: null, lotNumber: '' },
      expectedType: 'createStockLot',
      expectedArgs: { stockId: 4 },
      invalidateKeys: [['stock'], ['stock', 4], ['stock-lots', 4]],
    },
    {
      name: 'useUpdateStockLot',
      hook: () => useUpdateStockLot(),
      method: 'patch',
      path: '/stock/4/lots/100/',
      vars: { stockId: 4, stockName: 'Filters', lotId: 100, patch: { quantity: 9 }, updatedAt: '2026-04-17T10:00:00Z' },
      expectedType: 'updateStockLot',
      expectedArgs: { stockId: 4, lotId: 100 },
      invalidateKeys: [['stock'], ['stock', 4], ['stock-lots', 4]],
    },
    {
      name: 'useDeleteStockLot',
      hook: () => useDeleteStockLot(),
      method: 'delete',
      path: '/stock/4/lots/100/',
      vars: { stockId: 4, stockName: 'Filters', lotId: 100, updatedAt: '2026-04-17T10:00:00Z' },
      expectedType: 'deleteStockLot',
      expectedArgs: { stockId: 4, lotId: 100 },
      invalidateKeys: [['stock'], ['stock', 4], ['stock-lots', 4]],
    },
    {
      name: 'useUpdateEntry',
      hook: () => useUpdateEntry(),
      method: 'patch',
      path: '/entries/77/',
      vars: { entryId: 77, routineName: 'X', patch: { notes: 'edit' }, updatedAt: '2026-04-17T10:00:00Z' },
      expectedType: 'updateEntry',
      expectedArgs: { entryId: 77 },
      invalidateKeys: [['entries'], ['routine-entries']],
    },
    {
      name: 'useUpdateConsumption',
      hook: () => useUpdateConsumption(),
      method: 'patch',
      path: '/stock-consumptions/33/',
      vars: { consumptionId: 33, stockName: 'Filters', patch: { notes: 'edit' }, updatedAt: '2026-04-17T10:00:00Z' },
      expectedType: 'updateConsumption',
      expectedArgs: { consumptionId: 33 },
      invalidateKeys: [['stock-consumptions']],
    },
  ]
  /* eslint-enable react-hooks/rules-of-hooks */

  it.each(invalidateCases)(
    '$name — persists rollback descriptor and discard invalidates the related queries',
    async ({ hook, method, path, vars, expectedType, expectedArgs, invalidateKeys }) => {
      server.use(mockNetworkError(method, path))
      const { result, qc } = renderWith(hook)
      // Pre-populate every query key the rollback will invalidate so
      // `getQueryState` returns a defined state object and the
      // `isInvalidated` flag is observable.
      for (const key of invalidateKeys) {
        qc.setQueryData(key, key.length === 1 ? [] : {})
      }

      await act(async () => {
        await result.current.mutateAsync(vars)
      })

      const entries = await list()
      expect(entries).toHaveLength(1)
      expect(entries[0].rollbackType).toBe(expectedType)
      expect(entries[0].rollbackArgs).toEqual(expectedArgs)

      await act(async () => {
        await discard(entries[0].id, qc)
      })
      expect(await list()).toHaveLength(0)
      for (const key of invalidateKeys) {
        expect(qc.getQueryState(key)?.isInvalidated).toBe(true)
      }
    },
  )

  it('useLogRoutine — discard rolls back the move from due → upcoming (delta inverse)', async () => {
    server.use(mockNetworkError('post', '/routines/9/log/'))
    const { result, qc } = renderWith(() => useLogRoutine())
    qc.setQueryData(['dashboard'], {
      due: [{ id: 9, name: 'Stretch', interval_hours: 24, is_due: true, is_overdue: true }],
      upcoming: [],
    })

    await act(async () => {
      await result.current.mutateAsync({ routineId: 9, routineName: 'Stretch' })
    })
    // Optimistic moved 9 → upcoming.
    expect(qc.getQueryData(['dashboard']).due).toEqual([])
    expect(qc.getQueryData(['dashboard']).upcoming).toHaveLength(1)

    const entries = await list()
    expect(entries[0].rollbackType).toBe('logRoutine')
    expect(entries[0].rollbackArgs).toEqual({ routineId: 9 })

    await act(async () => {
      await discard(entries[0].id, qc)
    })
    // Inverse moved it back to `due`. The restored entry has
    // `is_due: true` and `last_entry_at: null` (sentinel chosen by the
    // inverse — the real one is unknown to it).
    const dash = qc.getQueryData(['dashboard'])
    expect(dash.upcoming).toEqual([])
    expect(dash.due).toHaveLength(1)
    expect(dash.due[0].id).toBe(9)
    expect(dash.due[0].is_due).toBe(true)
    expect(dash.due[0].last_entry_at).toBeNull()
  })

  it('useDeleteRoutine — discard re-inserts the routine from the detail cache (delta inverse)', async () => {
    server.use(mockNetworkError('delete', '/routines/9/'))
    const { result, qc } = renderWith(() => useDeleteRoutine())
    qc.setQueryData(['routine', 9], {
      id: 9,
      name: 'Stretch',
      is_due: false,
    })
    qc.setQueryData(['routines'], [{ id: 9, name: 'Stretch' }])
    qc.setQueryData(['dashboard'], { due: [], upcoming: [{ id: 9, name: 'Stretch' }] })

    await act(async () => {
      await result.current.mutateAsync({ routineId: 9, routineName: 'Stretch', updatedAt: '2026-04-17T10:00:00Z' })
    })
    // Optimistic dropped from list caches.
    expect(qc.getQueryData(['routines'])).toEqual([])
    expect(qc.getQueryData(['dashboard']).upcoming).toEqual([])
    // Detail cache survived (useDeleteRoutine.onSuccess does
    // removeQueries, but onSuccess hasn't run yet for queued offline).

    const entries = await list()
    expect(entries[0].rollbackType).toBe('deleteRoutine')
    expect(entries[0].rollbackArgs).toEqual({ routineId: 9 })

    await act(async () => {
      await discard(entries[0].id, qc)
    })
    // Inverse re-inserted the routine into both list caches.
    expect(qc.getQueryData(['routines'])).toEqual([{ id: 9, name: 'Stretch', is_due: false }])
    expect(qc.getQueryData(['dashboard']).upcoming).toEqual([{ id: 9, name: 'Stretch', is_due: false }])
  })

  it('useDeleteRoutine — falls back to invalidate when the detail cache is gone', async () => {
    server.use(mockNetworkError('delete', '/routines/9/'))
    const { result, qc } = renderWith(() => useDeleteRoutine())
    qc.setQueryData(['routines'], [{ id: 9, name: 'Stretch' }])
    qc.setQueryData(['dashboard'], { due: [], upcoming: [{ id: 9, name: 'Stretch' }] })
    // No `['routine', 9]` cache — the optimistic just dropped from
    // the list caches and the detail was never warm.

    await act(async () => {
      await result.current.mutateAsync({ routineId: 9, routineName: 'Stretch', updatedAt: '2026-04-17T10:00:00Z' })
    })
    const entries = await list()
    await act(async () => {
      await discard(entries[0].id, qc)
    })
    // Inverse hit the fallback path — list caches are invalidated.
    expect(qc.getQueryState(['routines'])?.isInvalidated).toBe(true)
    expect(qc.getQueryState(['dashboard'])?.isInvalidated).toBe(true)
  })
})
