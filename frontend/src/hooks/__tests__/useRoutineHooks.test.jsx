import 'fake-indexeddb/auto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockNetworkError } from '../../test/mocks/handlers'
import { server } from '../../test/mocks/server'
import { clear } from '../../offline/queue'
import { useDashboard } from '../useDashboard'
import { useRoutine, useRoutineEntries, useRoutines } from '../useRoutines'
import { useContacts } from '../useContacts'
import { useDeleteRoutine } from '../mutations/useDeleteRoutine'
import { useLogRoutine } from '../mutations/useLogRoutine'
import { useUpdateRoutine } from '../mutations/useUpdateRoutine'

const BASE = 'http://localhost/api'

function renderWithQuery(hookFn) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  return renderHook(hookFn, { wrapper })
}

beforeEach(() => {
  localStorage.setItem('access_token', 'test-token')
})

describe('routine query hooks', () => {
  it('useDashboard returns the JSON payload', async () => {
    server.use(http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [], upcoming: [{ id: 1 }] })))
    const { result } = renderWithQuery(() => useDashboard())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.upcoming).toEqual([{ id: 1 }])
  })

  it('useDashboard surfaces errors with status', async () => {
    server.use(http.get(`${BASE}/dashboard/`, () => new HttpResponse(null, { status: 500 })))
    const { result } = renderWithQuery(() => useDashboard())
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error.status).toBe(500)
  })

  it('useRoutines unwraps paginated results', async () => {
    server.use(http.get(`${BASE}/routines/`, () => HttpResponse.json({ results: [{ id: 7, name: 'x' }] })))
    const { result } = renderWithQuery(() => useRoutines())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 7, name: 'x' }])
  })

  it('useRoutines accepts a bare array too', async () => {
    server.use(http.get(`${BASE}/routines/`, () => HttpResponse.json([{ id: 1 }])))
    const { result } = renderWithQuery(() => useRoutines())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 1 }])
  })

  it('useRoutine is disabled when id is null', () => {
    const { result } = renderWithQuery(() => useRoutine(null))
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('useRoutine fetches a single routine', async () => {
    server.use(http.get(`${BASE}/routines/3/`, () => HttpResponse.json({ id: 3, name: 'Yoga' })))
    const { result } = renderWithQuery(() => useRoutine(3))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.name).toBe('Yoga')
  })

  it('useRoutine surfaces 404 with a status', async () => {
    server.use(http.get(`${BASE}/routines/999/`, () => new HttpResponse(null, { status: 404 })))
    const { result } = renderWithQuery(() => useRoutine(999))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error.status).toBe(404)
  })

  it('useRoutineEntries trims to the requested limit', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ id: i, notes: '' }))
    server.use(http.get(`${BASE}/routines/1/entries/`, () => HttpResponse.json(rows)))
    const { result } = renderWithQuery(() => useRoutineEntries(1, 3))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(3)
  })

  it('useContacts returns the list', async () => {
    server.use(http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json([{ id: 50, username: 'bob' }])))
    const { result } = renderWithQuery(() => useContacts())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 50, username: 'bob' }])
  })
})

// ── Routine mutation hooks — optimistic updates (T062) ─────────────────────

function makeMutClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function renderMut(hookFn, qc = makeMutClient()) {
  const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { result } = renderHook(hookFn, { wrapper })
  return { result, qc }
}

describe('routine mutation hooks — optimistic updates (T062)', () => {
  beforeEach(async () => {
    await clear()
  })

  afterEach(async () => {
    await clear()
  })

  it('useLogRoutine moves the routine from dashboard.due to dashboard.upcoming optimistically', async () => {
    // T112: the optimistic now MOVES the routine instead of just dropping
    // it from `due`, so the user doesn't see it vanish offline. The
    // backend invalidate after onSuccess overwrites the local
    // approximation when online.
    server.use(http.post(`${BASE}/routines/5/log/`, () => HttpResponse.json({ id: 42 }, { status: 201 })))
    const { result, qc } = renderMut(() => useLogRoutine())
    qc.setQueryData(['dashboard'], {
      due: [{ id: 5, name: 'Pills', interval_hours: 24 }],
      upcoming: [{ id: 6, name: 'Yoga', next_due_at: '2099-01-01T00:00:00Z' }],
    })

    await act(async () => {
      await result.current.mutateAsync({ routineId: 5 })
    })
    const dash = qc.getQueryData(['dashboard'])
    expect(dash.due).toEqual([])
    // Pills sits BEFORE Yoga because Yoga's next_due_at is far future.
    expect(dash.upcoming).toHaveLength(2)
    expect(dash.upcoming.map((r) => r.id)).toEqual([5, 6])
    const moved = dash.upcoming[0]
    expect(moved.id).toBe(5)
    expect(moved.is_due).toBe(false)
    expect(moved.is_overdue).toBe(false)
    expect(moved.next_due_at).toBeTruthy()
  })

  it('useLogRoutine rolls back the dashboard when the server rejects', async () => {
    server.use(http.post(`${BASE}/routines/5/log/`, () => new HttpResponse(null, { status: 400 })))
    const { result, qc } = renderMut(() => useLogRoutine())
    const original = { due: [{ id: 5, name: 'Pills' }], upcoming: [] }
    qc.setQueryData(['dashboard'], original)

    await act(async () => {
      try {
        await result.current.mutateAsync({ routineId: 5 })
      } catch {
        // expected
      }
    })
    expect(qc.getQueryData(['dashboard'])).toEqual(original)
  })

  it('useUpdateRoutine patches caches optimistically and keeps them when queued', async () => {
    server.use(mockNetworkError('patch', '/routines/5/'))
    const { result, qc } = renderMut(() => useUpdateRoutine())
    qc.setQueryData(['routine', 5], { id: 5, name: 'Pills' })
    qc.setQueryData(['routines'], [{ id: 5, name: 'Pills' }])

    let returned
    await act(async () => {
      returned = await result.current.mutateAsync({ routineId: 5, patch: { name: 'Vitamins' } })
    })
    expect(returned).toEqual({ __queued: true })
    expect(qc.getQueryData(['routine', 5])).toEqual({ id: 5, name: 'Vitamins' })
    expect(qc.getQueryData(['routines'])).toEqual([{ id: 5, name: 'Vitamins' }])
  })

  it('useUpdateRoutine rolls back on non-offline error', async () => {
    server.use(http.patch(`${BASE}/routines/5/`, () => new HttpResponse(null, { status: 400 })))
    const { result, qc } = renderMut(() => useUpdateRoutine())
    qc.setQueryData(['routine', 5], { id: 5, name: 'Pills' })

    await act(async () => {
      try {
        await result.current.mutateAsync({ routineId: 5, patch: { name: 'Vitamins' } })
      } catch {
        // expected
      }
    })
    expect(qc.getQueryData(['routine', 5])).toEqual({ id: 5, name: 'Pills' })
  })

  it('useDeleteRoutine drops the routine optimistically and rolls back on 4xx', async () => {
    server.use(http.delete(`${BASE}/routines/5/`, () => new HttpResponse(null, { status: 403 })))
    const { result, qc } = renderMut(() => useDeleteRoutine())
    qc.setQueryData(['routines'], [{ id: 5, name: 'Pills' }])
    qc.setQueryData(['dashboard'], { due: [{ id: 5 }], upcoming: [] })

    await act(async () => {
      try {
        await result.current.mutateAsync({ routineId: 5 })
      } catch {
        // expected
      }
    })
    expect(qc.getQueryData(['routines'])).toEqual([{ id: 5, name: 'Pills' }])
    expect(qc.getQueryData(['dashboard']).due).toEqual([{ id: 5 }])
  })
})

// Direct registry exercises for rollback edge cases. Hits the early-
// return branches inside `useLogRoutine` / `useDeleteRoutine` /
// `useConsumeStock` rollbacks that the happy-path tests above don't
// reach (empty caches, routine already moved, list rebuild fallback).
describe('rollback edge cases', () => {
  beforeEach(async () => {
    // Pre-import all hooks so the registry is dense.
    await import('../mutations/useLogRoutine')
    await import('../mutations/useDeleteRoutine')
    await import('../mutations/useConsumeStock')
  })

  function makeQc(seed = {}) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    for (const [key, value] of Object.entries(seed)) {
      qc.setQueryData(JSON.parse(key), value)
    }
    return qc
  }

  it('logRoutine rollback no-ops when the dashboard cache is empty', async () => {
    const { applyRollback } = await import('../../offline/rollbacks')
    const qc = makeQc()
    expect(applyRollback(qc, 'logRoutine', { routineId: 5 })).toBe(true)
    expect(qc.getQueryData(['dashboard'])).toBeUndefined()
  })

  it('logRoutine rollback no-ops when the routine is not in upcoming', async () => {
    const { applyRollback } = await import('../../offline/rollbacks')
    const qc = makeQc({
      [JSON.stringify(['dashboard'])]: { due: [{ id: 5 }], upcoming: [{ id: 9 }] },
    })
    applyRollback(qc, 'logRoutine', { routineId: 5 })
    // Untouched: upcoming still has only id 9, due still has id 5.
    const dash = qc.getQueryData(['dashboard'])
    expect(dash.upcoming.map((r) => r.id)).toEqual([9])
    expect(dash.due.map((r) => r.id)).toEqual([5])
  })

  it('logRoutine rollback rebuilds dashboard when due/upcoming arrays are missing', async () => {
    // Hits the `prev.upcoming ?? []` and `prev.due ?? []` fallbacks.
    const { applyRollback } = await import('../../offline/rollbacks')
    const qc = makeQc({
      [JSON.stringify(['dashboard'])]: {
        // Both arrays missing — the rollback must default to []. Routine
        // not present in upcoming so the rollback no-ops, but the
        // ?? [] branches still execute on the way to the find().
      },
    })
    applyRollback(qc, 'logRoutine', { routineId: 5 })
    expect(qc.getQueryData(['dashboard'])).toEqual({})
  })

  it('logRoutine rollback restores the routine to due when found in upcoming', async () => {
    // Hits the `restored` build + the `qc.setQueryData(['routine', id])`
    // branch where prev is truthy.
    const { applyRollback } = await import('../../offline/rollbacks')
    const qc = makeQc({
      [JSON.stringify(['dashboard'])]: {
        due: [{ id: 9 }],
        upcoming: [{ id: 5, name: 'Pills', is_due: false, is_overdue: false }],
      },
      [JSON.stringify(['routine', 5])]: { id: 5, name: 'Pills', is_due: false, is_overdue: false },
    })
    applyRollback(qc, 'logRoutine', { routineId: 5 })
    const dash = qc.getQueryData(['dashboard'])
    expect(dash.upcoming.map((r) => r.id)).toEqual([])
    expect(dash.due.map((r) => r.id).sort()).toEqual([5, 9])
    const moved = dash.due.find((r) => r.id === 5)
    expect(moved.is_due).toBe(true)
    expect(moved.is_overdue).toBe(true)
    // ['routine', id] branch where prev is truthy.
    expect(qc.getQueryData(['routine', 5])).toMatchObject({ is_due: true, is_overdue: true })
  })

  it('logRoutine rollback leaves ["routine", id] alone when its cache is null', async () => {
    // Hits the `prev ? {...} : prev` else-branch on the ['routine', id]
    // setter (cache exists but holds null).
    const { applyRollback } = await import('../../offline/rollbacks')
    const qc = makeQc({
      [JSON.stringify(['routine', 5])]: null,
    })
    applyRollback(qc, 'logRoutine', { routineId: 5 })
    expect(qc.getQueryData(['routine', 5])).toBeNull()
  })

  it('logRoutine optimistic returns prev unchanged when dashboard is missing', async () => {
    server.use(mockNetworkError('post', '/routines/5/log/'))
    const { result, qc } = renderMut(() => useLogRoutine())
    // No dashboard cache pre-seeded — optimistic must early-return prev.
    await act(async () => {
      try {
        await result.current.mutateAsync({ routineId: 5 })
      } catch {
        // expected — network error
      }
    })
    expect(qc.getQueryData(['dashboard'])).toBeUndefined()
  })

  it('logRoutine optimistic sorts upcoming when an entry has null next_due_at', async () => {
    server.use(mockNetworkError('post', '/routines/5/log/'))
    const { result, qc } = renderMut(() => useLogRoutine())
    qc.setQueryData(['dashboard'], {
      due: [{ id: 5, name: 'Pills', interval_hours: 12 }],
      upcoming: [{ id: 7, name: 'Yoga' /* next_due_at omitted -> null */ }],
    })
    await act(async () => {
      try {
        await result.current.mutateAsync({ routineId: 5 })
      } catch {
        // queued offline
      }
    })
    const dash = qc.getQueryData(['dashboard'])
    expect(dash.upcoming.map((r) => r.id).sort()).toEqual([5, 7])
  })

  it('deleteRoutine rollback falls back to invalidate when detail cache is missing', async () => {
    const { applyRollback } = await import('../../offline/rollbacks')
    const qc = makeQc({
      [JSON.stringify(['routines'])]: [],
      [JSON.stringify(['dashboard'])]: { due: [], upcoming: [] },
    })
    applyRollback(qc, 'deleteRoutine', { routineId: 5 })
    expect(qc.getQueryState(['routines']).isInvalidated).toBe(true)
    expect(qc.getQueryState(['dashboard']).isInvalidated).toBe(true)
  })

  it('deleteRoutine rollback re-inserts into routines + dashboard from detail', async () => {
    const { applyRollback } = await import('../../offline/rollbacks')
    const qc = makeQc({
      [JSON.stringify(['routine', 5])]: { id: 5, name: 'Pills', is_due: true },
      [JSON.stringify(['routines'])]: [],
      [JSON.stringify(['dashboard'])]: { due: [], upcoming: [] },
    })
    applyRollback(qc, 'deleteRoutine', { routineId: 5 })
    expect(qc.getQueryData(['routines']).map((r) => r.id)).toEqual([5])
    expect(qc.getQueryData(['dashboard']).due.map((r) => r.id)).toEqual([5])
  })

  it('deleteRoutine rollback no-ops when caches are non-array / missing', async () => {
    const { applyRollback } = await import('../../offline/rollbacks')
    // Detail present so we don't hit the invalidate fallback.
    const qc = makeQc({
      [JSON.stringify(['routine', 5])]: { id: 5, name: 'Pills', is_due: false },
    })
    applyRollback(qc, 'deleteRoutine', { routineId: 5 })
    // Routines + dashboard untouched (not arrays / not seeded).
    expect(qc.getQueryData(['routines'])).toBeUndefined()
    expect(qc.getQueryData(['dashboard'])).toBeUndefined()
  })

  it('deleteRoutine rollback skips re-insert when routine already present', async () => {
    const { applyRollback } = await import('../../offline/rollbacks')
    const qc = makeQc({
      [JSON.stringify(['routine', 5])]: { id: 5, name: 'Pills', is_due: true },
      [JSON.stringify(['routines'])]: [{ id: 5, name: 'Pills' }],
      [JSON.stringify(['dashboard'])]: { due: [{ id: 5 }], upcoming: [] },
    })
    applyRollback(qc, 'deleteRoutine', { routineId: 5 })
    expect(qc.getQueryData(['routines'])).toHaveLength(1)
    expect(qc.getQueryData(['dashboard']).due).toHaveLength(1)
  })

  it('consumeStock rollback no-ops when the stock cache is missing', async () => {
    const { applyRollback } = await import('../../offline/rollbacks')
    const qc = makeQc()
    applyRollback(qc, 'consumeStock', { stockId: 5, quantity: 1, lotSelections: [] })
    expect(qc.getQueryData(['stock', 5])).toBeUndefined()
  })

  it('consumeStock rollback re-inserts a deleted lot stub', async () => {
    // Lot 100 was filtered out by the optimistic when its quantity hit 0.
    // The rollback must put it back as a minimal stub so the UI shows it
    // again until the next refetch repaints the canonical fields.
    const { applyRollback } = await import('../../offline/rollbacks')
    const qc = makeQc({
      [JSON.stringify(['stock', 5])]: {
        id: 5,
        quantity: 0,
        lots: [], // lot 100 was filtered out by the optimistic
      },
    })
    applyRollback(qc, 'consumeStock', {
      stockId: 5,
      quantity: 3,
      lotSelections: [{ lot_id: 100, quantity: 3 }],
    })
    const stock = qc.getQueryData(['stock', 5])
    expect(stock.quantity).toBe(3)
    expect(stock.lots).toEqual([{ id: 100, quantity: 3 }])
  })

  it('consumeStock rollback in FEFO mode (no lotSelections) only restores total quantity', async () => {
    const { applyRollback } = await import('../../offline/rollbacks')
    const qc = makeQc({
      [JSON.stringify(['stock', 5])]: {
        id: 5,
        quantity: 7,
        lots: [{ id: 1, quantity: 4 }],
      },
    })
    // FEFO mode: lotSelections empty → rollback bumps total quantity but
    // can't pinpoint which lots to credit. Lots stay as-is.
    applyRollback(qc, 'consumeStock', { stockId: 5, quantity: 3, lotSelections: [] })
    const stock = qc.getQueryData(['stock', 5])
    expect(stock.quantity).toBe(10)
    expect(stock.lots).toEqual([{ id: 1, quantity: 4 }])
  })

  it('consumeStock rollback skips lots whose selection has zero quantity', async () => {
    const { applyRollback } = await import('../../offline/rollbacks')
    const qc = makeQc({
      [JSON.stringify(['stock', 5])]: {
        id: 5,
        quantity: 2,
        lots: [{ id: 1, quantity: 2 }],
      },
    })
    // Selection with qty 0 must NOT alter lot 1 (early return inside the
    // map callback). Total quantity bumps by 0 too.
    applyRollback(qc, 'consumeStock', {
      stockId: 5,
      quantity: 0,
      lotSelections: [{ lot_id: 1, quantity: 0 }],
    })
    const stock = qc.getQueryData(['stock', 5])
    expect(stock.lots).toEqual([{ id: 1, quantity: 2 }])
    expect(stock.quantity).toBe(2)
  })

  it('consumeStock rollback also patches the list cache (["stock"])', async () => {
    const { applyRollback } = await import('../../offline/rollbacks')
    const qc = makeQc({
      [JSON.stringify(['stock'])]: [
        { id: 5, quantity: 0, lots: [] },
        { id: 9, quantity: 5, lots: [] }, // unrelated, must stay untouched
      ],
    })
    applyRollback(qc, 'consumeStock', {
      stockId: 5,
      quantity: 1,
      lotSelections: [{ lot_id: 1, quantity: 1 }],
    })
    const list = qc.getQueryData(['stock'])
    expect(list[0]).toMatchObject({ id: 5, quantity: 1 })
    expect(list[1]).toEqual({ id: 9, quantity: 5, lots: [] })
  })

  it('consumeStock rollback no-ops on the list when prev is not an array', async () => {
    const { applyRollback } = await import('../../offline/rollbacks')
    const qc = makeQc({
      [JSON.stringify(['stock'])]: { not: 'an array' },
    })
    applyRollback(qc, 'consumeStock', {
      stockId: 5,
      quantity: 1,
      lotSelections: [],
    })
    expect(qc.getQueryData(['stock'])).toEqual({ not: 'an array' })
  })
})
