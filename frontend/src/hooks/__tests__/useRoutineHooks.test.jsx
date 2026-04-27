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
