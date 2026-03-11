import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import RoutineDetailPage from '../RoutineDetailPage'

const BASE = 'http://localhost/api'

function renderDetail(overrides = {}) {
  return renderWithProviders(
    <Routes>
      <Route path="/routines/:id" element={<RoutineDetailPage />} />
      <Route path="/" element={<div>Home</div>} />
    </Routes>,
    { initialEntries: ['/routines/1'], ...overrides },
  )
}

const routine = {
  id: 1,
  name: 'Take vitamins',
  description: 'Daily vitamins',
  interval_hours: 24,
  is_active: true,
  is_due: true,
  is_overdue: true,
  hours_until_due: -2,
  next_due_at: new Date(Date.now() - 2 * 3600000).toISOString(),
  created_at: '2025-01-15T10:00:00Z',
  stock_name: 'Vitamin D',
  stock_quantity: 10,
  stock_usage: 1,
  stock: 1,
}

describe('RoutineDetailPage', () => {
  beforeEach(() => {
    server.use(
      http.get(`${BASE}/routines/1/`, () => HttpResponse.json(routine)),
      http.get(`${BASE}/routines/1/entries/`, () =>
        HttpResponse.json([{ id: 10, created_at: '2025-02-20T09:00:00Z', notes: null }]),
      ),
    )
  })

  it('shows loading state', () => {
    renderDetail()
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
  })

  it('shows error state on API failure', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.error()))
    renderDetail()
    await waitFor(() => expect(screen.getByText(/Could not load data/)).toBeInTheDocument())
  })

  it('shows not found when routine is null', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => new HttpResponse(null, { status: 404 })))
    renderDetail()
    await waitFor(() => expect(screen.getByText('Routine not found.')).toBeInTheDocument())
  })

  it('renders routine name and description', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText('Take vitamins')).toBeInTheDocument())
    expect(screen.getByText('Daily vitamins')).toBeInTheDocument()
  })

  it('renders interval, status, and next due meta', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText('Take vitamins')).toBeInTheDocument())
    expect(screen.getByText('Every day')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('renders stock info', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText(/Vitamin D/)).toBeInTheDocument())
  })

  it('shows mark as done button when due', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText('Mark as done')).toBeInTheDocument())
  })

  it('shows error when mark done fails', async () => {
    server.use(http.post(`${BASE}/routines/1/log/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderDetail()
    await waitFor(() => expect(screen.getByText('Mark as done')).toBeInTheDocument())
    await user.click(screen.getByText('Mark as done'))
    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('shows error when toggle active fails', async () => {
    server.use(http.patch(`${BASE}/routines/1/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderDetail()
    await waitFor(() => expect(screen.getByText('Deactivate')).toBeInTheDocument())
    await user.click(screen.getByText('Deactivate'))
    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('marks as done and refreshes', async () => {
    let logCalled = false
    server.use(
      http.post(`${BASE}/routines/1/log/`, () => {
        logCalled = true
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )
    const { user } = renderDetail()
    await waitFor(() => expect(screen.getByText('Mark as done')).toBeInTheDocument())
    await user.click(screen.getByText('Mark as done'))
    await waitFor(() => expect(logCalled).toBe(true))
  })

  it('toggles active state', async () => {
    let patched = false
    server.use(
      http.patch(`${BASE}/routines/1/`, () => {
        patched = true
        return HttpResponse.json({ ...routine, is_active: false })
      }),
    )
    const { user } = renderDetail()
    await waitFor(() => expect(screen.getByText('Deactivate')).toBeInTheDocument())
    await user.click(screen.getByText('Deactivate'))
    await waitFor(() => expect(patched).toBe(true))
  })

  it('shows delete confirmation and deletes', async () => {
    const { user } = renderDetail()
    await waitFor(() => expect(screen.getByText('Delete')).toBeInTheDocument())
    await user.click(screen.getByText('Delete'))
    // Confirm modal should appear
    expect(screen.getByText(/Delete "Take vitamins"/)).toBeInTheDocument()
    await user.click(screen.getAllByText('Delete').find((btn) => btn.closest('[role="dialog"]')))
    await waitFor(() => expect(screen.getByText('Home')).toBeInTheDocument())
  })

  it('renders recent history entries', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText('Recent history')).toBeInTheDocument())
    expect(screen.getByText('View all →')).toBeInTheDocument()
  })

  it('shows lot selection modal when routine requires_lot_selection', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ ...routine, requires_lot_selection: true })))
    const { user } = renderDetail()
    await waitFor(() => expect(screen.getByText('Mark as done')).toBeInTheDocument())

    await user.click(screen.getByText('Mark as done'))

    await waitFor(() => expect(screen.getByText('Select items to consume')).toBeInTheDocument())
  })

  it('confirms lot selection and calls log with lot_selections', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ ...routine, requires_lot_selection: true })))
    let logBody = null
    server.use(
      http.post(`${BASE}/routines/1/log/`, async ({ request }) => {
        logBody = await request.json()
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )

    const { user } = renderDetail()
    await waitFor(() => expect(screen.getByText('Mark as done')).toBeInTheDocument())

    await user.click(screen.getByText('Mark as done'))
    await waitFor(() => expect(screen.getByText('Select items to consume')).toBeInTheDocument())

    await user.click(screen.getByText('LOT-A'))
    await user.click(screen.getByText('Confirm'))

    await waitFor(() => expect(logBody).not.toBeNull())
    expect(logBody.lot_selections).toEqual([{ lot_id: 1, quantity: 1 }])
  })

  it('multi mode: pre-distributes and confirms with stepper', async () => {
    server.use(
      http.get(`${BASE}/routines/1/`, () =>
        HttpResponse.json({ ...routine, stock_usage: 3, requires_lot_selection: true }),
      ),
      http.get(`${BASE}/routines/1/lots-for-selection/`, () =>
        HttpResponse.json([
          { lot_id: 1, lot_number: 'LOT-A', expiry_date: '2027-01-01', quantity: 2 },
          { lot_id: 2, lot_number: 'LOT-B', expiry_date: '2027-06-01', quantity: 5 },
        ]),
      ),
    )
    let logBody = null
    server.use(
      http.post(`${BASE}/routines/1/log/`, async ({ request }) => {
        logBody = await request.json()
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )

    const { user } = renderDetail()
    await waitFor(() => expect(screen.getByText('Mark as done')).toBeInTheDocument())

    await user.click(screen.getByText('Mark as done'))
    await waitFor(() => expect(screen.getByText(/Distribute 3 units across lots/)).toBeInTheDocument())

    // FEFO pre-distributes: LOT-A=2, LOT-B=1 → total=3/3
    expect(screen.getByText(/3\/3/)).toBeInTheDocument()

    await user.click(screen.getByText('Confirm'))

    await waitFor(() => expect(logBody).not.toBeNull())
    expect(logBody.lot_selections).toEqual([
      { lot_id: 1, quantity: 2 },
      { lot_id: 2, quantity: 1 },
    ])
  })

  it('cancels lot selection modal without logging', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ ...routine, requires_lot_selection: true })))
    let logCalled = false
    server.use(
      http.post(`${BASE}/routines/1/log/`, () => {
        logCalled = true
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )

    const { user } = renderDetail()
    await waitFor(() => expect(screen.getByText('Mark as done')).toBeInTheDocument())

    await user.click(screen.getByText('Mark as done'))
    await waitFor(() => expect(screen.getByText('Select items to consume')).toBeInTheDocument())

    await user.click(screen.getByText('Cancel'))

    expect(logCalled).toBe(false)
    expect(screen.queryByText('Select items to consume')).not.toBeInTheDocument()
  })

  it('shows error when delete fails', async () => {
    server.use(http.delete(`${BASE}/routines/1/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderDetail()
    await waitFor(() => expect(screen.getByText('Delete')).toBeInTheDocument())
    await user.click(screen.getByText('Delete'))
    await user.click(screen.getAllByText('Delete').find((btn) => btn.closest('[role="dialog"]')))
    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('auto-marks done when opened with action=mark-done', async () => {
    let logCalled = false
    server.use(
      http.post(`${BASE}/routines/1/log/`, () => {
        logCalled = true
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )
    renderWithProviders(
      <Routes>
        <Route path="/routines/:id" element={<RoutineDetailPage />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>,
      { initialEntries: ['/routines/1?action=mark-done'] },
    )
    await waitFor(() => expect(logCalled).toBe(true))
  })

  it('shows error when lot selection fetch fails', async () => {
    server.use(
      http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ ...routine, requires_lot_selection: true })),
      http.get(`${BASE}/routines/1/lots-for-selection/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { user } = renderDetail()
    await waitFor(() => expect(screen.getByText('Mark as done')).toBeInTheDocument())
    await user.click(screen.getByText('Mark as done'))
    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('shows error when lot confirm log fails', async () => {
    server.use(
      http.get(`${BASE}/routines/1/`, () =>
        HttpResponse.json({ ...routine, requires_lot_selection: true, stock_usage: 1 }),
      ),
      http.post(`${BASE}/routines/1/log/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { user } = renderDetail()
    await waitFor(() => expect(screen.getByText('Mark as done')).toBeInTheDocument())

    await user.click(screen.getByText('Mark as done'))
    await waitFor(() => expect(screen.getByText('Select items to consume')).toBeInTheDocument())

    await user.click(screen.getByText('LOT-A'))
    await user.click(screen.getByText('Confirm'))

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('shows interval in hours for non-standard intervals', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ ...routine, interval_hours: 8 })))
    renderDetail()
    await waitFor(() => expect(screen.getByText('Every 8h')).toBeInTheDocument())
  })

  it('shows "Due now" when next_due_at is null', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ ...routine, next_due_at: null })))
    renderDetail()
    await waitFor(() => expect(screen.getByText('Due now')).toBeInTheDocument())
  })

  it('shows notes on entries that have notes', async () => {
    server.use(
      http.get(`${BASE}/routines/1/entries/`, () =>
        HttpResponse.json([{ id: 10, created_at: '2025-02-20T09:00:00Z', notes: 'took with meal' }]),
      ),
    )
    renderDetail()
    await waitFor(() => expect(screen.getByText('took with meal')).toBeInTheDocument())
  })

  it('does not show stock info when stock_name is null', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ ...routine, stock_name: null })))
    renderDetail()
    await waitFor(() => expect(screen.getByText('Take vitamins')).toBeInTheDocument())
    expect(screen.queryByText(/Vitamin D/)).not.toBeInTheDocument()
  })

  it('shows interval in weeks', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ ...routine, interval_hours: 168 })))
    renderDetail()
    await waitFor(() => expect(screen.getByText('Every week')).toBeInTheDocument())
  })

  it('shows interval in months', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ ...routine, interval_hours: 720 })))
    renderDetail()
    await waitFor(() => expect(screen.getByText('Every month')).toBeInTheDocument())
  })

  it('shows interval in years', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ ...routine, interval_hours: 8760 })))
    renderDetail()
    await waitFor(() => expect(screen.getByText('Every year')).toBeInTheDocument())
  })

  it('shows advance button when routine is not due but active', async () => {
    server.use(
      http.get(`${BASE}/routines/1/`, () =>
        HttpResponse.json({ ...routine, is_due: false, is_overdue: false, hours_until_due: 12 }),
      ),
    )
    renderDetail()
    await waitFor(() => expect(screen.getByText('Do it now')).toBeInTheDocument())
  })

  it('shows inactive status and activate button', async () => {
    server.use(
      http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ ...routine, is_active: false, is_due: false })),
    )
    renderDetail()
    await waitFor(() => expect(screen.getByText('Inactive')).toBeInTheDocument())
    expect(screen.getByText('Activate')).toBeInTheDocument()
  })

  it('renders back and edit links', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText('← Back')).toBeInTheDocument())
    expect(screen.getByText('Edit')).toBeInTheDocument()
  })

  it('shows next due with both relative and absolute datetime', async () => {
    const futureDate = new Date(Date.now() + 3 * 24 * 3600000) // ~3 days from now
    server.use(
      http.get(`${BASE}/routines/1/`, () =>
        HttpResponse.json({ ...routine, next_due_at: futureDate.toISOString(), is_due: false }),
      ),
    )
    renderDetail()
    await waitFor(() => expect(screen.getByText('Take vitamins')).toBeInTheDocument())
    // Should contain the separator · between relative and absolute parts
    const nextDueValue = screen.getByText(/·/)
    expect(nextDueValue).toBeInTheDocument()
  })

  it('shows stock usage with translated format', async () => {
    const { container } = renderDetail()
    await waitFor(() => expect(screen.getByText('Take vitamins')).toBeInTheDocument())
    // "10 × Vitamin D (uses 1 per log)"
    expect(container.textContent).toMatch(/Vitamin D/)
    expect(container.textContent).toMatch(/uses 1 per log/)
  })
})

describe('RoutineDetailPage — advance button', () => {
  const notDueRoutine = {
    id: 1,
    name: 'Take vitamins',
    interval_hours: 24,
    is_active: true,
    is_due: false,
    requires_lot_selection: false,
    next_due_at: new Date(Date.now() + 20 * 3600000).toISOString(),
    stock_name: null,
    stock_quantity: null,
    stock_usage: null,
    stock: null,
  }

  beforeEach(() => {
    server.use(
      http.get(`${BASE}/routines/1/`, () => HttpResponse.json(notDueRoutine)),
      http.get(`${BASE}/routines/1/entries/`, () => HttpResponse.json([])),
    )
  })

  it('shows advance button when not due and active', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText('Do it now')).toBeInTheDocument())
    expect(screen.queryByText('Mark as done')).not.toBeInTheDocument()
  })

  it('does not show advance button when due', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ ...notDueRoutine, is_due: true })))
    renderDetail()
    await waitFor(() => expect(screen.getByText('Mark as done')).toBeInTheDocument())
    expect(screen.queryByText('Do it now')).not.toBeInTheDocument()
  })

  it('does not show advance button when inactive', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ ...notDueRoutine, is_active: false })))
    renderDetail()
    await waitFor(() => expect(screen.getByText('Take vitamins')).toBeInTheDocument())
    expect(screen.queryByText('Do it now')).not.toBeInTheDocument()
  })

  it('shows confirmation modal when advance button clicked', async () => {
    const { user } = renderDetail()
    await waitFor(() => expect(screen.getByText('Do it now')).toBeInTheDocument())
    await user.click(screen.getByText('Do it now'))
    expect(screen.getByText('Log this routine ahead of schedule?')).toBeInTheDocument()
  })

  it('logs routine after advance confirmation', async () => {
    let logCalled = false
    server.use(
      http.post(`${BASE}/routines/1/log/`, () => {
        logCalled = true
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )
    const { user } = renderDetail()
    await waitFor(() => expect(screen.getByText('Do it now')).toBeInTheDocument())
    await user.click(screen.getByText('Do it now'))
    await user.click(screen.getAllByText('Do it now')[1])
    await waitFor(() => expect(logCalled).toBe(true))
  })

  it('cancels advance confirmation without logging', async () => {
    let logCalled = false
    server.use(
      http.post(`${BASE}/routines/1/log/`, () => {
        logCalled = true
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )
    const { user } = renderDetail()
    await waitFor(() => expect(screen.getByText('Do it now')).toBeInTheDocument())
    await user.click(screen.getByText('Do it now'))
    await user.click(screen.getByText('Cancel'))
    expect(logCalled).toBe(false)
    expect(screen.queryByText('Log this routine ahead of schedule?')).not.toBeInTheDocument()
  })

  it('shows error when advance log fails', async () => {
    server.use(http.post(`${BASE}/routines/1/log/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderDetail()
    await waitFor(() => expect(screen.getByText('Do it now')).toBeInTheDocument())
    await user.click(screen.getByText('Do it now'))
    await user.click(screen.getAllByText('Do it now')[1])
    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })
})
