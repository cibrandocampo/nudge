import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import DashboardPage from '../DashboardPage'

const BASE = 'http://localhost/api'

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

  it('shows empty message when no routines due', async () => {
    renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('All caught up!')).toBeInTheDocument())
  })

  it('renders + New routine link', async () => {
    renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('+ New routine')).toBeInTheDocument())
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

    await user.click(screen.getByText('Done'))

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
      stock_usage: 1,
      requires_lot_selection: true,
    }
    server.use(http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [dueRoutine], upcoming: [] })))

    const { user } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())

    await user.click(screen.getByText('Done'))

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
      stock_usage: 1,
      requires_lot_selection: true,
    }
    let logBody = null
    server.use(
      http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [dueRoutine], upcoming: [] })),
      http.post(`${BASE}/routines/1/log/`, async ({ request }) => {
        logBody = await request.json()
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )

    const { user } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())

    await user.click(screen.getByText('Done'))
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
      stock_usage: 3,
      requires_lot_selection: true,
    }
    let logBody = null
    server.use(
      http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [dueRoutine], upcoming: [] })),
      http.get(`${BASE}/routines/1/lots-for-selection/`, () =>
        HttpResponse.json([
          { lot_id: 1, lot_number: 'LOT-A', expiry_date: '2027-01-01', quantity: 2 },
          { lot_id: 2, lot_number: 'LOT-B', expiry_date: '2027-06-01', quantity: 5 },
        ]),
      ),
      http.post(`${BASE}/routines/1/log/`, async ({ request }) => {
        logBody = await request.json()
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )

    const { user } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())

    await user.click(screen.getByText('Done'))
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
      stock_usage: 1,
      requires_lot_selection: true,
    }
    let logCalled = false
    server.use(
      http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [dueRoutine], upcoming: [] })),
      http.post(`${BASE}/routines/1/log/`, () => {
        logCalled = true
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )

    const { user } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())

    await user.click(screen.getByText('Done'))
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
      http.post(`${BASE}/routines/1/log/`, () => {
        logCalled = true
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )

    const { user } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())

    await user.click(screen.getByText('Done'))

    await waitFor(() => expect(screen.getByText('All caught up!')).toBeInTheDocument())
  })

  // ── Sharing ────────────────────────────────────────────────────────────────

  it('shows share popover button on routine cards when contacts exist', async () => {
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
              shared_with: [],
              shared_with_details: [],
              is_owner: true,
              owner_username: 'testuser',
            },
          ],
          upcoming: [],
        }),
      ),
      http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json([{ id: 10, username: 'alice' }])),
    )
    renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())
    expect(screen.getByLabelText('Share')).toBeInTheDocument()
  })

  it('toggles share on a routine via the share popover', async () => {
    let patchBody = null
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
              shared_with: [],
              shared_with_details: [],
              is_owner: true,
              owner_username: 'testuser',
            },
          ],
          upcoming: [],
        }),
      ),
      http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json([{ id: 10, username: 'alice' }])),
      http.patch(`${BASE}/routines/:id/`, async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({})
      }),
    )
    const { user } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())

    // Open share popover
    await user.click(screen.getByLabelText('Share'))
    // Toggle alice checkbox
    await user.click(screen.getByText('alice'))

    await waitFor(() => expect(patchBody).not.toBeNull())
    expect(patchBody.shared_with).toEqual([10])
  })

  it('shows error when lot selection fetch fails on dashboard', async () => {
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
      stock_usage: 1,
      requires_lot_selection: true,
    }
    server.use(
      http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [dueRoutine], upcoming: [] })),
      http.get(`${BASE}/routines/1/lots-for-selection/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { user } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())
    await user.click(screen.getByText('Done'))
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
      stock_usage: 1,
      requires_lot_selection: true,
    }
    server.use(
      http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [dueRoutine], upcoming: [] })),
      http.post(`${BASE}/routines/1/log/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { user } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())

    await user.click(screen.getByText('Done'))
    await waitFor(() => expect(screen.getByText('Select items to consume')).toBeInTheDocument())

    await user.click(screen.getByText('LOT-A'))
    await user.click(screen.getByText('Confirm'))

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('toggles share on routine with null shared_with', async () => {
    let patchBody = null
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
              shared_with: null,
              shared_with_details: [],
              is_owner: true,
              owner_username: 'testuser',
            },
          ],
          upcoming: [],
        }),
      ),
      http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json([{ id: 10, username: 'alice' }])),
      http.patch(`${BASE}/routines/:id/`, async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({})
      }),
    )
    const { user } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())

    await user.click(screen.getByLabelText('Share'))
    await user.click(screen.getByText('alice'))

    await waitFor(() => expect(patchBody).not.toBeNull())
    expect(patchBody.shared_with).toEqual([10])
  })

  it('opens ShareModal for routine and closes it', async () => {
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
              shared_with: [],
              shared_with_details: [],
              is_owner: true,
              owner_username: 'testuser',
            },
          ],
          upcoming: [],
        }),
      ),
      http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json([{ id: 10, username: 'alice' }])),
    )
    const { user } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())

    await user.click(screen.getByLabelText('Share'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /close/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('renders null when shareRoutineId points to routine no longer in data', async () => {
    let fetchCount = 0
    server.use(
      http.get(`${BASE}/dashboard/`, () => {
        fetchCount++
        if (fetchCount === 1) {
          return HttpResponse.json({
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
                shared_with: [],
                shared_with_details: [],
                is_owner: true,
                owner_username: 'testuser',
              },
            ],
            upcoming: [],
          })
        }
        // Second fetch (after share toggle) returns empty lists
        return HttpResponse.json({ due: [], upcoming: [] })
      }),
      http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json([{ id: 10, username: 'alice' }])),
      http.patch(`${BASE}/routines/:id/`, () => HttpResponse.json({})),
    )
    const { user } = renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())

    // Open ShareModal
    await user.click(screen.getByLabelText('Share'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    // Toggle share — triggers handleToggleShare → patch + fetchDashboard
    // After re-fetch, routine disappears from data but shareRoutineId remains set
    await user.click(screen.getByText('alice'))
    // Modal should close or render null since routine no longer in data
    await waitFor(() => expect(screen.queryByText('Vitamins')).not.toBeInTheDocument())
  })

  it('shows owner label on shared routine where user is not owner', async () => {
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
              owner_username: 'alice',
            },
          ],
        }),
      ),
    )
    renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Shared routine')).toBeInTheDocument())
    expect(screen.getByText('alice')).toBeInTheDocument()
  })
})
