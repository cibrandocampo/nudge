import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import DashboardPage from '../DashboardPage'

const BASE = 'http://localhost/api'

describe('DashboardPage', () => {
  it('shows loading state initially', () => {
    renderWithProviders(<DashboardPage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
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
    await user.click(screen.getByText('LOT-A (1)'))
    await user.click(screen.getByText('Confirm'))

    await waitFor(() => expect(logBody).not.toBeNull())
    expect(logBody.lot_selections).toEqual([{ lot_id: 1, quantity: 1 }])
  })

  it('cancels lot selection modal without logging', async () => {
    const dueRoutine = {
      id: 1,
      name: 'Vitamins',
      next_due_at: new Date(Date.now() - 3600000).toISOString(),
      created_at: '2025-01-01T00:00:00Z',
      is_due: true,
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
})
