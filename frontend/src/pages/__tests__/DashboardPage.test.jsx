import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { mockNetworkError } from '../../test/mocks/handlers'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import { clear, list } from '../../offline/queue'
import DashboardPage, { HIGHLIGHT_MS } from '../DashboardPage'

const reachableRef = { current: true }
vi.mock('../../hooks/useServerReachable', () => ({
  useServerReachable: () => reachableRef.current,
}))

const BASE = 'http://localhost/api'

// Stock returned by GET /stock/ for the lot-selection modal tests.
// The lot list is derived from the cached stock, so every test that
// needs the modal must seed the list cache.
const stockForLotSelection = {
  id: 10,
  name: 'Filters',
  quantity: 5,
  lots: [
    { id: 1, lot_number: 'LOT-A', expiry_date: '2027-01-01', quantity: 2, created_at: '2026-01-01T00:00:00Z' },
    { id: 2, lot_number: 'LOT-B', expiry_date: '2027-06-01', quantity: 5, created_at: '2026-01-02T00:00:00Z' },
  ],
}
const stockListHandler = http.get(`${BASE}/stock/`, () => HttpResponse.json([stockForLotSelection]))

describe('DashboardPage', () => {
  it('shows loading state initially', () => {
    renderWithProviders(<DashboardPage />)
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
  })

  it('shows error state on API failure', async () => {
    server.use(http.get(`${BASE}/dashboard/`, () => new HttpResponse(null, { status: 500 })))
    renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText(/Could not load data/)).toBeInTheDocument())
  })

  it('renders Today and Upcoming sections', async () => {
    renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Today')).toBeInTheDocument())
    expect(screen.getByText('Upcoming')).toBeInTheDocument()
  })

  it('shows empty message when no routines due but the user has routines', async () => {
    // The dashboard distinguishes "all caught up today" (at least one
    // routine exists) from "no routines yet". Here we simulate the former.
    server.use(http.get(`${BASE}/routines/`, () => HttpResponse.json([{ id: 1, name: 'Vitamins', next_due_at: null }])))
    renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('All caught up!')).toBeInTheDocument())
  })

  it('renders the page title and the new-routine link in the top bar', async () => {
    renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Routines' })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: '+ New routine' })).toBeInTheDocument()
  })

  it('renders the new-routine control as an aria-disabled button when offline', async () => {
    reachableRef.current = false
    try {
      renderWithProviders(<DashboardPage />)
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Routines' })).toBeInTheDocument())
      const btn = screen.getByRole('button', { name: '+ New routine' })
      // Not `disabled` — the click fires the offline toast instead.
      expect(btn).toHaveAttribute('aria-disabled', 'true')
      expect(btn).toHaveAttribute('title', 'This section is not available offline.')
      expect(screen.queryByRole('link', { name: '+ New routine' })).not.toBeInTheDocument()
    } finally {
      reachableRef.current = true
    }
  })

  it('explains with a toast that the new-routine page is unavailable when clicked offline', async () => {
    reachableRef.current = false
    try {
      const { user } = renderWithProviders(<DashboardPage />)
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Routines' })).toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: '+ New routine' }))
      // The button's title carries the same sentence; only the toast renders it as text.
      expect(await screen.findByText('This section is not available offline.')).toBeInTheDocument()
    } finally {
      reachableRef.current = true
    }
  })

  it('renders routine cards when API returns data', async () => {
    server.use(
      http.get(`${BASE}/dashboard/`, () =>
        HttpResponse.json({
          due: [
            {
              id: 1,
              name: 'Vitamins',
              next_due_at: new Date(Date.now() - 3600000).toISOString(),
              created_at: '2025-01-01T00:00:00Z',
              is_due: true,
              is_overdue: true,
              hours_until_due: -1,
              stock_name: null,
              stock_quantity: null,
            },
          ],
          upcoming: [
            {
              id: 2,
              name: 'Water filter',
              next_due_at: new Date(Date.now() + 86400000).toISOString(),
              created_at: '2025-01-01T00:00:00Z',
              is_due: false,
              hours_until_due: 24,
              stock_name: null,
              stock_quantity: null,
            },
          ],
        }),
      ),
    )
    renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())
    expect(screen.getByText('Water filter')).toBeInTheDocument()
  })

  it('shows error when mark done fails', async () => {
    const dueRoutine = {
      id: 1,
      name: 'Vitamins',
      next_due_at: new Date(Date.now() - 3600000).toISOString(),
      created_at: '2025-01-01T00:00:00Z',
      is_due: true,
      is_overdue: true,
      hours_until_due: -1,
      stock_name: null,
      stock_quantity: null,
    }
    server.use(
      http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [dueRoutine], upcoming: [] })),
      http.post(`${BASE}/routines/1/log/`, () => new HttpResponse(null, { status: 500 })),
    )

    const { user } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /done/i }))

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('shows lot selection modal when routine requires_lot_selection', async () => {
    const dueRoutine = {
      id: 1,
      name: 'Vitamins',
      next_due_at: new Date(Date.now() - 3600000).toISOString(),
      created_at: '2025-01-01T00:00:00Z',
      is_due: true,
      is_overdue: true,
      hours_until_due: -1,
      stock_name: 'Filters',
      stock_quantity: 5,
      stock: 10,
      stock_usage: 1,
      requires_lot_selection: true,
    }
    server.use(
      http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [dueRoutine], upcoming: [] })),
      stockListHandler,
    )

    const { user, queryClient } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())
    // Ensure the stock cache warmed by useStockList is populated before the click.
    await waitFor(() => expect(queryClient.getQueryData(['stock'])).toBeTruthy())

    await user.click(screen.getByRole('button', { name: /done/i }))

    await waitFor(() => expect(screen.getByText('Select items to consume')).toBeInTheDocument())
  })

  it('confirms lot selection and calls log with lot_selections', async () => {
    const dueRoutine = {
      id: 1,
      name: 'Vitamins',
      next_due_at: new Date(Date.now() - 3600000).toISOString(),
      created_at: '2025-01-01T00:00:00Z',
      is_due: true,
      is_overdue: true,
      hours_until_due: -1,
      stock_name: 'Filters',
      stock_quantity: 5,
      stock: 10,
      stock_usage: 1,
      requires_lot_selection: true,
    }
    let logBody = null
    server.use(
      http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [dueRoutine], upcoming: [] })),
      stockListHandler,
      http.post(`${BASE}/routines/1/log/`, async ({ request }) => {
        logBody = await request.json()
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )

    const { user, queryClient } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())
    await waitFor(() => expect(queryClient.getQueryData(['stock'])).toBeTruthy())

    await user.click(screen.getByRole('button', { name: /done/i }))
    await waitFor(() => expect(screen.getByText('Select items to consume')).toBeInTheDocument())

    // Select one lot and confirm
    await user.click(screen.getByText('LOT-A'))
    await user.click(screen.getByText('Confirm'))

    await waitFor(() => expect(logBody).not.toBeNull())
    expect(logBody.lot_selections).toEqual([{ lot_id: 1, quantity: 1 }])
  })

  it('multi mode: pre-distributes and confirms with stepper', async () => {
    const dueRoutine = {
      id: 1,
      name: 'Vitamins',
      next_due_at: new Date(Date.now() - 3600000).toISOString(),
      created_at: '2025-01-01T00:00:00Z',
      is_due: true,
      is_overdue: true,
      hours_until_due: -1,
      stock_name: 'Filters',
      stock_quantity: 5,
      stock: 10,
      stock_usage: 3,
      requires_lot_selection: true,
    }
    let logBody = null
    server.use(
      http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [dueRoutine], upcoming: [] })),
      stockListHandler,
      http.post(`${BASE}/routines/1/log/`, async ({ request }) => {
        logBody = await request.json()
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )

    const { user, queryClient } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())
    await waitFor(() => expect(queryClient.getQueryData(['stock'])).toBeTruthy())

    await user.click(screen.getByRole('button', { name: /done/i }))
    await waitFor(() => expect(screen.getByText(/Distribute 3 units across lots/)).toBeInTheDocument())

    // FEFO pre-distributes: LOT-A=2, LOT-B=1 → total=3/3
    expect(screen.getByText(/3\/3/)).toBeInTheDocument()

    // Confirm with pre-distributed values
    await user.click(screen.getByText('Confirm'))

    await waitFor(() => expect(logBody).not.toBeNull())
    expect(logBody.lot_selections).toEqual([
      { lot_id: 1, quantity: 2 },
      { lot_id: 2, quantity: 1 },
    ])
  })

  it('cancels lot selection modal without logging', async () => {
    const dueRoutine = {
      id: 1,
      name: 'Vitamins',
      next_due_at: new Date(Date.now() - 3600000).toISOString(),
      created_at: '2025-01-01T00:00:00Z',
      is_due: true,
      is_overdue: true,
      hours_until_due: -1,
      stock_name: 'Filters',
      stock_quantity: 5,
      stock: 10,
      stock_usage: 1,
      requires_lot_selection: true,
    }
    let logCalled = false
    server.use(
      http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [dueRoutine], upcoming: [] })),
      stockListHandler,
      http.post(`${BASE}/routines/1/log/`, () => {
        logCalled = true
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )

    const { user, queryClient } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())
    await waitFor(() => expect(queryClient.getQueryData(['stock'])).toBeTruthy())

    await user.click(screen.getByRole('button', { name: /done/i }))
    await waitFor(() => expect(screen.getByText('Select items to consume')).toBeInTheDocument())

    await user.click(screen.getByText('Cancel'))

    expect(logCalled).toBe(false)
    expect(screen.queryByText('Select items to consume')).not.toBeInTheDocument()
  })

  it('marks a routine done and refreshes', async () => {
    const dueRoutine = {
      id: 1,
      name: 'Vitamins',
      next_due_at: new Date(Date.now() - 3600000).toISOString(),
      created_at: '2025-01-01T00:00:00Z',
      is_due: true,
      is_overdue: true,
      hours_until_due: -1,
      stock_name: null,
      stock_quantity: null,
    }
    let logCalled = false
    server.use(
      http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: logCalled ? [] : [dueRoutine], upcoming: [] })),
      // The full routines list has the routine the user just logged — so
      // the post-log empty state resolves to "all caught up", not
      // "no routines yet".
      http.get(`${BASE}/routines/`, () => HttpResponse.json([dueRoutine])),
      http.post(`${BASE}/routines/1/log/`, () => {
        logCalled = true
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )

    const { user } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /done/i }))

    await waitFor(() => expect(screen.getByText('All caught up!')).toBeInTheDocument())
  })

  // ── Sharing ────────────────────────────────────────────────────────────────
  // Dashboard cards no longer expose share actions — sharing is edited from
  // the routine form. The card only surfaces a passive `shared-badge` when
  // the owner has shared the routine, and an owner label when the viewer is
  // the recipient.

  it('surfaces a passive shared-badge on owner cards when the routine is shared', async () => {
    server.use(
      http.get(`${BASE}/dashboard/`, () =>
        HttpResponse.json({
          due: [
            {
              id: 1,
              name: 'Vitamins',
              next_due_at: new Date(Date.now() - 3600000).toISOString(),
              created_at: '2025-01-01T00:00:00Z',
              is_due: true,
              is_overdue: true,
              hours_until_due: -1,
              stock_name: null,
              stock_quantity: null,
              shared_with: [10],
              shared_with_details: [{ id: 10, username: 'alice' }],
              is_owner: true,
              owner_display_name: 'testuser',
            },
          ],
          upcoming: [],
        }),
      ),
    )
    renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())
    expect(screen.getByTestId('shared-badge')).toBeInTheDocument()
    // No interactive share affordance remains on the card.
    expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument()
  })

  it('shows error when the stock cache has no lots available for selection', async () => {
    // Simulates the "cache empty / never fetched" branch by returning an
    // empty stock list — the lot picker derives lots from the cached stock.
    const dueRoutine = {
      id: 1,
      name: 'Vitamins',
      next_due_at: new Date(Date.now() - 3600000).toISOString(),
      created_at: '2025-01-01T00:00:00Z',
      is_due: true,
      is_overdue: true,
      hours_until_due: -1,
      stock_name: 'Filters',
      stock_quantity: 5,
      stock: 10,
      stock_usage: 1,
      requires_lot_selection: true,
    }
    server.use(
      http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [dueRoutine], upcoming: [] })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([])),
    )
    const { user } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /done/i }))
    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('shows error when lot confirm log fails on dashboard', async () => {
    const dueRoutine = {
      id: 1,
      name: 'Vitamins',
      next_due_at: new Date(Date.now() - 3600000).toISOString(),
      created_at: '2025-01-01T00:00:00Z',
      is_due: true,
      is_overdue: true,
      hours_until_due: -1,
      stock_name: 'Filters',
      stock_quantity: 5,
      stock: 10,
      stock_usage: 1,
      requires_lot_selection: true,
    }
    server.use(
      http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [dueRoutine], upcoming: [] })),
      stockListHandler,
      http.post(`${BASE}/routines/1/log/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { user, queryClient } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())
    await waitFor(() => expect(queryClient.getQueryData(['stock'])).toBeTruthy())

    await user.click(screen.getByRole('button', { name: /done/i }))
    await waitFor(() => expect(screen.getByText('Select items to consume')).toBeInTheDocument())

    await user.click(screen.getByText('LOT-A'))
    await user.click(screen.getByText('Confirm'))

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('queues the log offline when the POST hits a network error', async () => {
    // T065: the per-action "Saved / will sync later" toast was removed;
    // instead the mutation lands in the offline queue and the optimistic
    // update removes the routine from the dashboard.
    await clear()
    const dueRoutine = {
      id: 1,
      name: 'Vitamins',
      next_due_at: new Date(Date.now() - 3600000).toISOString(),
      created_at: '2025-01-01T00:00:00Z',
      is_due: true,
      is_overdue: true,
      hours_until_due: -1,
      stock_name: null,
      stock_quantity: null,
    }
    server.use(
      http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [dueRoutine], upcoming: [] })),
      mockNetworkError('post', '/routines/1/log/'),
    )
    const { user } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /done/i }))

    await waitFor(async () => expect(await list()).toHaveLength(1))
    await clear()
  })

  it('surfaces the owner via the recipient-variant shared badge when the user is not the owner', async () => {
    server.use(
      http.get(`${BASE}/dashboard/`, () =>
        HttpResponse.json({
          due: [],
          upcoming: [
            {
              id: 2,
              name: 'Shared routine',
              next_due_at: new Date(Date.now() + 86400000).toISOString(),
              created_at: '2025-01-01T00:00:00Z',
              is_due: false,
              hours_until_due: 24,
              stock_name: null,
              stock_quantity: null,
              shared_with: [1],
              shared_with_details: [{ id: 1, username: 'testuser' }],
              is_owner: false,
              owner_display_name: 'alice',
            },
          ],
        }),
      ),
    )
    renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Shared routine')).toBeInTheDocument())
    const badge = screen.getByTestId('shared-badge')
    expect(badge.getAttribute('data-variant')).toBe('recipient')
    expect(badge.getAttribute('aria-label')).toContain('alice')
  })
})

// ── Completing from the dashboard (T102) ───────────────────────────────────
// The check on the card's action layer (same action as the swipe) plays the
// exit, then logs. Due and upcoming routines both complete.

describe('DashboardPage — completing routines', () => {
  const hour = 3600 * 1000
  const upcomingRoutine = {
    id: 2,
    name: 'Water filter',
    next_due_at: new Date(Date.now() + 5 * hour).toISOString(),
    last_entry_at: null,
    created_at: '2025-01-01T00:00:00Z',
    is_due: false,
    is_overdue: false,
    hours_until_due: 5,
    interval_hours: 48,
    stock_name: null,
    stock_quantity: null,
  }
  const dueRoutine = {
    id: 1,
    name: 'Vitamins',
    next_due_at: new Date(Date.now() - hour).toISOString(),
    created_at: '2025-01-01T00:00:00Z',
    is_due: true,
    is_overdue: true,
    hours_until_due: -1,
    interval_hours: 24,
    stock_name: null,
    stock_quantity: null,
  }
  const lotRoutine = {
    ...dueRoutine,
    stock_name: 'Filters',
    stock_quantity: 5,
    stock: 10,
    stock_usage: 1,
    requires_lot_selection: true,
  }

  // What the server returns once a routine has been logged.
  const redated = (routine) => ({
    ...routine,
    is_due: false,
    is_overdue: false,
    last_entry_at: new Date().toISOString(),
    next_due_at: new Date(Date.now() + routine.interval_hours * hour).toISOString(),
    hours_until_due: routine.interval_hours,
  })
  const section = (title) => screen.getByRole('heading', { name: title }).closest('section')
  const cardIn = (title, name) => within(section(title)).getByText(name).closest('[data-testid="routine-card"]')
  const checkOf = (card) => within(card).getByRole('button', { name: 'Mark as done' })

  // The page keeps fetching (routines, stock) after a test's last assertion;
  // let every request settle inside `waitFor` so no update lands after the
  // test ended ("not wrapped in act"). Notifications are synchronous in tests
  // (src/test/setup.js).
  let activeClient
  const renderDashboard = () => {
    const view = renderWithProviders(<DashboardPage />)
    activeClient = view.queryClient
    return view
  }

  afterEach(async () => {
    await waitFor(() => expect(activeClient.isFetching() + activeClient.isMutating()).toBe(0))
    await clear()
  })

  it('completes an upcoming routine, which stays in Upcoming with its new date', async () => {
    let logged = false
    server.use(
      // After the log the server answers with the re-dated routine, as the
      // backend does; the refetch triggered by onSuccess must not undo it.
      http.get(`${BASE}/dashboard/`, () =>
        HttpResponse.json({ due: [], upcoming: [logged ? redated(upcomingRoutine) : upcomingRoutine] }),
      ),
      http.post(`${BASE}/routines/2/log/`, () => {
        logged = true
        return HttpResponse.json({ id: 77 }, { status: 201 })
      }),
    )
    const { user, queryClient } = renderDashboard()
    await waitFor(() => expect(screen.getByText('Water filter')).toBeInTheDocument())

    await user.click(checkOf(cardIn('Upcoming', 'Water filter')))

    await waitFor(() => expect(logged).toBe(true))
    const moved = queryClient.getQueryData(['dashboard']).upcoming.find((r) => r.id === 2)
    expect(new Date(moved.next_due_at).getTime()).toBeGreaterThan(Date.now() + 47 * hour)
    // The card that played its exit is back at rest in its new place.
    expect(cardIn('Upcoming', 'Water filter')).toHaveAttribute('data-phase', 'rest')
  })

  it('shows the Marked as done toast with Undo when the completion is saved online', async () => {
    server.use(
      http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [dueRoutine], upcoming: [] })),
      http.post(`${BASE}/routines/1/log/`, () => HttpResponse.json({ id: 77 }, { status: 201 })),
    )
    const { user } = renderDashboard()
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())

    await user.click(checkOf(cardIn('Today', 'Vitamins')))

    const toast = await screen.findByText('Marked as done')
    expect(within(toast.closest('[role="status"]')).getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('Undo on the Marked as done toast deletes the entry and brings the routine back to Today', async () => {
    let logged = false
    const deleted = []
    server.use(
      http.get(`${BASE}/dashboard/`, () =>
        HttpResponse.json(logged ? { due: [], upcoming: [redated(dueRoutine)] } : { due: [dueRoutine], upcoming: [] }),
      ),
      http.post(`${BASE}/routines/1/log/`, () => {
        logged = true
        return HttpResponse.json({ id: 77 }, { status: 201 })
      }),
      http.delete(`${BASE}/entries/:id/`, ({ params }) => {
        deleted.push(params.id)
        logged = false
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user } = renderDashboard()
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())
    await user.click(checkOf(cardIn('Today', 'Vitamins')))
    await waitFor(() => expect(cardIn('Upcoming', 'Vitamins')).toBeInTheDocument())

    const toast = await screen.findByText('Marked as done')
    await user.click(within(toast.closest('[role="status"]')).getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(cardIn('Today', 'Vitamins')).toBeInTheDocument())
    expect(deleted).toEqual(['77'])
  })

  it('shows the offline toast without Undo when the completion is queued', async () => {
    server.use(
      http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [dueRoutine], upcoming: [] })),
      mockNetworkError('post', '/routines/1/log/'),
    )
    const { user } = renderDashboard()
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())

    await user.click(checkOf(cardIn('Today', 'Vitamins')))

    const toast = await screen.findByText("Done — will be saved when you're back online")
    expect(within(toast.closest('[role="status"]')).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    expect(screen.queryByText('Marked as done')).not.toBeInTheDocument()
    // The queued entry reaches the card as its pending-sync badge (read from
    // IndexedDB asynchronously, so it is awaited before the test ends).
    expect(await screen.findByTestId('sync-status-badge')).toHaveAttribute('data-state', 'pending')
  })

  it('brings a lot-selection card back to rest and logs nothing until the picker confirms', async () => {
    let logCalled = false
    server.use(
      http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [lotRoutine], upcoming: [] })),
      stockListHandler,
      http.post(`${BASE}/routines/1/log/`, () => {
        logCalled = true
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )
    const { user, queryClient } = renderDashboard()
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())
    await waitFor(() => expect(queryClient.getQueryData(['stock'])).toBeTruthy())

    await user.click(checkOf(cardIn('Today', 'Vitamins')))

    await waitFor(() => expect(screen.getByText('Select items to consume')).toBeInTheDocument())
    expect(cardIn('Today', 'Vitamins')).toHaveAttribute('data-phase', 'rest')
    expect(logCalled).toBe(false)
  })

  it('shows the error and brings the card back to rest when the server rejects', async () => {
    server.use(
      http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [], upcoming: [upcomingRoutine] })),
      http.post(`${BASE}/routines/2/log/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { user } = renderDashboard()
    await waitFor(() => expect(screen.getByText('Water filter')).toBeInTheDocument())

    await user.click(checkOf(cardIn('Upcoming', 'Water filter')))

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
    expect(cardIn('Upcoming', 'Water filter')).toHaveAttribute('data-phase', 'rest')
  })

  it('highlights the completed routine in Upcoming and then clears the highlight', async () => {
    let logged = false
    server.use(
      http.get(`${BASE}/dashboard/`, () =>
        HttpResponse.json(logged ? { due: [], upcoming: [redated(dueRoutine)] } : { due: [dueRoutine], upcoming: [] }),
      ),
      http.post(`${BASE}/routines/1/log/`, () => {
        logged = true
        return HttpResponse.json({ id: 77 }, { status: 201 })
      }),
    )
    const { user } = renderDashboard()
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())

    await user.click(checkOf(cardIn('Today', 'Vitamins')))

    await waitFor(() => expect(cardIn('Upcoming', 'Vitamins')).toHaveAttribute('data-highlighted', 'true'))
    await waitFor(() => expect(cardIn('Upcoming', 'Vitamins')).not.toHaveAttribute('data-highlighted'), {
      timeout: HIGHLIGHT_MS + 1000,
    })
  })

  it('blocks a stock-depleted upcoming routine', async () => {
    const blocked = {
      ...upcomingRoutine,
      stock_name: 'Ibuprofen',
      stock_quantity: 0,
      stock_quantity_available: 0,
      stock_usage: 1,
    }
    server.use(http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [], upcoming: [blocked] })))
    renderDashboard()
    await waitFor(() => expect(screen.getByText('Water filter')).toBeInTheDocument())

    const check = checkOf(cardIn('Upcoming', 'Water filter'))
    expect(check).toHaveAttribute('aria-disabled', 'true')
    expect(check).toHaveAttribute('title', 'No stock available')
  })
})
