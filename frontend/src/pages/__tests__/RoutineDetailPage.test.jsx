import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { clear, list } from '../../offline/queue'
import { mockNetworkError } from '../../test/mocks/handlers'
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

// Stock used to feed the lot-selection modal — T063 derives the list from
// this cached stock instead of a dedicated endpoint.
const stockForLotSelection = {
  id: 1,
  name: 'Vitamin D',
  quantity: 10,
  lots: [
    { id: 1, lot_number: 'LOT-A', expiry_date: '2027-01-01', quantity: 2, created_at: '2026-01-01T00:00:00Z' },
    { id: 2, lot_number: 'LOT-B', expiry_date: '2027-06-01', quantity: 5, created_at: '2026-01-02T00:00:00Z' },
  ],
}
const stockListHandler = http.get(`${BASE}/stock/`, () => HttpResponse.json([stockForLotSelection]))

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

  it('paints the stock row with the severity dot derived from the cached stock', async () => {
    // Severity contract is the post-T164 3-tier ('critical' | 'low' | 'ok').
    // The legacy 'out' literal was removed; passing it would yield no dot.
    server.use(
      http.get(`${BASE}/stock/`, () =>
        HttpResponse.json([{ ...stockForLotSelection, quantity: 0, stock_severity: 'critical' }]),
      ),
    )
    renderDetail()
    const dot = await screen.findByTestId('stock-severity-dot')
    expect(dot.className).toContain('dotDanger')
  })

  it('paints the stock dot warning when severity is "low"', async () => {
    server.use(
      http.get(`${BASE}/stock/`, () =>
        HttpResponse.json([{ ...stockForLotSelection, quantity: 2, stock_severity: 'low' }]),
      ),
    )
    renderDetail()
    const dot = await screen.findByTestId('stock-severity-dot')
    expect(dot.className).toContain('dotWarning')
  })

  it('paints the stock dot success when severity is "ok"', async () => {
    server.use(
      http.get(`${BASE}/stock/`, () =>
        HttpResponse.json([{ ...stockForLotSelection, quantity: 10, stock_severity: 'ok' }]),
      ),
    )
    renderDetail()
    const dot = await screen.findByTestId('stock-severity-dot')
    expect(dot.className).toContain('dotSuccess')
  })

  it('omits the severity dot until the stock cache resolves', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText(/Vitamin D/)).toBeInTheDocument())
    expect(screen.queryByTestId('stock-severity-dot')).not.toBeInTheDocument()
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
    const deactivate = await screen.findByRole('button', { name: 'Deactivate' })
    await user.click(deactivate)
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
    const deactivate = await screen.findByRole('button', { name: 'Deactivate' })
    await user.click(deactivate)
    await waitFor(() => expect(patched).toBe(true))
  })

  it('shows delete confirmation and deletes', async () => {
    const { user } = renderDetail()
    const deleteBtn = await screen.findByRole('button', { name: 'Delete' })
    await user.click(deleteBtn)
    // Confirm modal should appear
    expect(screen.getByText(/Delete "Take vitamins"/)).toBeInTheDocument()
    await user.click(screen.getAllByText('Delete').find((btn) => btn.closest('[role="dialog"]')))
    await waitFor(() => expect(screen.getByText('Home')).toBeInTheDocument())
  })

  it('renders recent history entries', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText('Recent history')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'View all →' })).toBeInTheDocument()
  })

  it('shows lot selection modal when routine requires_lot_selection', async () => {
    server.use(
      http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ ...routine, requires_lot_selection: true })),
      stockListHandler,
    )
    const { user, queryClient } = renderDetail()
    await waitFor(() => expect(screen.getByText('Mark as done')).toBeInTheDocument())
    await waitFor(() => expect(queryClient.getQueryData(['stock'])).toBeTruthy())

    await user.click(screen.getByText('Mark as done'))

    await waitFor(() => expect(screen.getByText('Select items to consume')).toBeInTheDocument())
  })

  it('confirms lot selection and calls log with lot_selections', async () => {
    let logBody = null
    server.use(
      http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ ...routine, requires_lot_selection: true })),
      stockListHandler,
      http.post(`${BASE}/routines/1/log/`, async ({ request }) => {
        logBody = await request.json()
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )

    const { user, queryClient } = renderDetail()
    await waitFor(() => expect(screen.getByText('Mark as done')).toBeInTheDocument())
    await waitFor(() => expect(queryClient.getQueryData(['stock'])).toBeTruthy())

    await user.click(screen.getByText('Mark as done'))
    await waitFor(() => expect(screen.getByText('Select items to consume')).toBeInTheDocument())

    await user.click(screen.getByText('LOT-A'))
    await user.click(screen.getByText('Confirm'))

    await waitFor(() => expect(logBody).not.toBeNull())
    expect(logBody.lot_selections).toEqual([{ lot_id: 1, quantity: 1 }])
  })

  it('multi mode: pre-distributes and confirms with stepper', async () => {
    let logBody = null
    server.use(
      http.get(`${BASE}/routines/1/`, () =>
        HttpResponse.json({ ...routine, stock_usage: 3, requires_lot_selection: true }),
      ),
      stockListHandler,
      http.post(`${BASE}/routines/1/log/`, async ({ request }) => {
        logBody = await request.json()
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )

    const { user, queryClient } = renderDetail()
    await waitFor(() => expect(screen.getByText('Mark as done')).toBeInTheDocument())
    await waitFor(() => expect(queryClient.getQueryData(['stock'])).toBeTruthy())

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
    let logCalled = false
    server.use(
      http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ ...routine, requires_lot_selection: true })),
      stockListHandler,
      http.post(`${BASE}/routines/1/log/`, () => {
        logCalled = true
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )

    const { user, queryClient } = renderDetail()
    await waitFor(() => expect(screen.getByText('Mark as done')).toBeInTheDocument())
    await waitFor(() => expect(queryClient.getQueryData(['stock'])).toBeTruthy())

    await user.click(screen.getByText('Mark as done'))
    await waitFor(() => expect(screen.getByText('Select items to consume')).toBeInTheDocument())

    await user.click(screen.getByText('Cancel'))

    expect(logCalled).toBe(false)
    expect(screen.queryByText('Select items to consume')).not.toBeInTheDocument()
  })

  it('shows error when delete fails', async () => {
    server.use(http.delete(`${BASE}/routines/1/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderDetail()
    const deleteBtn = await screen.findByRole('button', { name: 'Delete' })
    await user.click(deleteBtn)
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

  it('shows error when no lots are available for selection (empty stock cache)', async () => {
    server.use(
      http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ ...routine, requires_lot_selection: true })),
      // Empty stock list → findCachedStock returns undefined → no lots.
      http.get(`${BASE}/stock/`, () => HttpResponse.json([])),
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
      stockListHandler,
      http.post(`${BASE}/routines/1/log/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { user, queryClient } = renderDetail()
    await waitFor(() => expect(screen.getByText('Mark as done')).toBeInTheDocument())
    await waitFor(() => expect(queryClient.getQueryData(['stock'])).toBeTruthy())

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
    expect(screen.getByRole('button', { name: 'Activate' })).toBeInTheDocument()
  })

  it('renders back link and edit button', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText('← Back to routines')).toBeInTheDocument())
    // T182: pencil is a `<button>` so it can show the offline toast.
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
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

  it('shows stock summary and per-log usage in separate rows', async () => {
    const { container } = renderDetail()
    await waitFor(() => expect(screen.getByText('Take vitamins')).toBeInTheDocument())
    // Stock row: "10 × Vitamin D"
    expect(container.textContent).toMatch(/10 × Vitamin D/)
    // Per-log row: separate label "Per log" + value "1 u." (DOM nodes
    // concatenate without spaces in textContent, so allow optional
    // whitespace between label and value).
    expect(container.textContent).toMatch(/Per log\s*1 u\./)
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

  it('queues toggleActive offline when the PATCH hits a network error', async () => {
    await clear()
    server.use(mockNetworkError('patch', '/routines/1/'))
    const { user } = renderDetail()
    await waitFor(() => expect(screen.getByText('Take vitamins')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Deactivate' }))
    await waitFor(async () => expect(await list()).toHaveLength(1))
    await clear()
  })

  it('queues delete offline when the DELETE hits a network error', async () => {
    await clear()
    server.use(mockNetworkError('delete', '/routines/1/'))
    const { user } = renderDetail()
    await waitFor(() => expect(screen.getByText('Take vitamins')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    // ConfirmModal exposes its confirm button with the routine.detail.delete label
    const confirmButtons = screen.getAllByText('Delete')
    await user.click(confirmButtons[confirmButtons.length - 1])
    await waitFor(async () => expect(await list()).toHaveLength(1))
    await clear()
  })

  it('shows the owner username when the routine is shared with the current user', async () => {
    const sharedRoutine = { ...routine, is_owner: false, owner_username: 'alice' }
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json(sharedRoutine)))
    renderDetail()
    await screen.findByText('Take vitamins')
    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.getByText('alice')).toBeInTheDocument()
  })

  it('hides Edit/Delete/toggle-active for shared users (owner-only writes)', async () => {
    // Backend ``IsOwner`` permission rejects update/destroy from non-owners
    // with 403 "Only the owner can modify this resource." We avoid letting
    // the user click into a guaranteed failure: the three owner-only
    // actions disappear when ``is_owner === false``.
    const sharedRoutine = { ...routine, is_owner: false, owner_username: 'alice' }
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json(sharedRoutine)))
    renderDetail()
    await screen.findByText('Take vitamins')
    expect(screen.queryByRole('link', { name: /^edit$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^deactivate$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^activate$/i })).not.toBeInTheDocument()
    // The history link survives — read access is allowed for shared users.
    expect(screen.getByRole('link', { name: /view all/i })).toBeInTheDocument()
  })

  it('keeps Edit/Delete/toggle-active visible for owners', async () => {
    // Pinned alongside the previous test: dropping the wrapping condition
    // would make the previous one pass while breaking this one.
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ ...routine, is_owner: true })))
    renderDetail()
    await screen.findByText('Take vitamins')
    // T182: pencil is a `<button>` (not a `<Link>`).
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument()
    // ``is_active: true`` so the button reads "Deactivate".
    expect(screen.getByRole('button', { name: /^deactivate$/i })).toBeInTheDocument()
  })

  it('renders the shared-with chips when the owner has shared the routine', async () => {
    const ownedShared = {
      ...routine,
      is_owner: true,
      shared_with_details: [{ id: 20, username: 'bob', first_name: 'Bob', last_name: 'Smith' }],
    }
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json(ownedShared)))
    renderDetail()
    const block = await screen.findByTestId('shared-with-info')
    expect(within(block).getByText('Shared with')).toBeInTheDocument()
    // Read-only chips render the username (not the full display label).
    expect(within(block).getByText('bob')).toBeInTheDocument()
  })

  it('shared user sees owner alone in "Owner" section and other recipients in "Shared with"', async () => {
    // Owner is singular — the "Propietario" section must contain ONLY
    // the owner chip. Other recipients (excluding the viewer) move to a
    // sibling "Shared with" section, matching the symmetric experience
    // an owner already gets when they share with people.
    const sharedRoutine = {
      ...routine,
      is_owner: false,
      owner_username: 'alice',
      shared_with_details: [
        { id: 30, username: 'testuser', first_name: '', last_name: '' },
        { id: 31, username: 'carol', first_name: 'Carol', last_name: '' },
      ],
    }
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json(sharedRoutine)))
    renderDetail()
    const ownerSection = await screen.findByTestId('owner-info')
    expect(ownerSection).toHaveTextContent('Owner')
    expect(ownerSection).toHaveTextContent('alice')
    expect(ownerSection).not.toHaveTextContent('carol')
    expect(ownerSection).not.toHaveTextContent('testuser')
    const sharedSection = screen.getByTestId('shared-with-info')
    expect(sharedSection).toHaveTextContent('Shared with')
    expect(sharedSection).toHaveTextContent('carol')
    expect(sharedSection).not.toHaveTextContent('testuser')
    expect(sharedSection).not.toHaveTextContent('alice')
  })

  it('shared user sees no "Shared with" section when they are the only recipient', async () => {
    const sharedRoutine = {
      ...routine,
      is_owner: false,
      owner_username: 'alice',
      shared_with_details: [{ id: 30, username: 'testuser', first_name: '', last_name: '' }],
    }
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json(sharedRoutine)))
    renderDetail()
    await screen.findByTestId('owner-info')
    expect(screen.queryByTestId('shared-with-info')).not.toBeInTheDocument()
  })
})

describe('RoutineDetailPage — stock-depleted disables action buttons', () => {
  // The backend rejects POST /api/routines/{id}/log/ with 422
  // `insufficient_stock` when the linked stock can't satisfy `stock_usage`.
  // The UI must not let the user click into a guaranteed failure: both the
  // "Mark as done" (when due) and "Do it now" (advance, when not due)
  // buttons stay rendered (so the user understands the routine has an
  // action) but disabled and tooltipped, matching the dashboard card.

  it('marks the "Mark as done" button as aria-disabled when the linked stock is depleted', async () => {
    const depletedRoutine = {
      ...routine,
      is_due: true,
      is_overdue: true,
      stock: 9,
      stock_name: 'Descaler tablets',
      stock_quantity: 0,
      stock_quantity_available: 0,
      stock_usage: 1,
    }
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json(depletedRoutine)))
    renderDetail()
    // The button is *not* `disabled` (so click can fire and surface the
    // toast); the no-stock state is communicated via `aria-disabled` and
    // the title attribute. Matches the dashboard card pattern.
    const button = await screen.findByRole('button', { name: /Mark as done/i })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button.getAttribute('title')).toMatch(/no stock/i)
  })

  it('marks the "Do it now" button as aria-disabled when not due and stock is depleted', async () => {
    const depletedRoutine = {
      ...routine,
      is_due: false,
      is_overdue: false,
      is_active: true,
      stock: 9,
      stock_name: 'Descaler tablets',
      stock_quantity: 0,
      stock_quantity_available: 0,
      stock_usage: 1,
    }
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json(depletedRoutine)))
    renderDetail()
    const button = await screen.findByRole('button', { name: /Do it now/i })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button.getAttribute('title')).toMatch(/no stock/i)
  })

  it('paints the detail card with the danger border when stock is depleted (T173 follow-up)', async () => {
    const depletedRoutine = {
      ...routine,
      is_due: false,
      is_overdue: false,
      stock: 9,
      stock_name: 'Descaler tablets',
      stock_quantity: 0,
      stock_quantity_available: 0,
      stock_usage: 1,
    }
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json(depletedRoutine)))
    const { container } = renderDetail()
    await screen.findByText(/Take vitamins/)
    expect(container.querySelector('[class*="cardBorderDanger"]')).toBeInTheDocument()
    expect(container.querySelector('[class*="cardBorderSuccess"]')).not.toBeInTheDocument()
  })

  it('forces the stock dot to danger when the routine query says depleted, even if cached stock still reports "low"', async () => {
    // Reproduces the post Mark-done lag: the routine query refetched fast
    // (its `stock_quantity_available` dropped to 0) but the `['stock']`
    // cache hasn't been refreshed yet so it still carries the previous
    // severity. Without the routine-driven escalation the dot would stay
    // orange ("low") next to a "0 × <stock>" row.
    const depletedRoutine = {
      ...routine,
      is_due: true,
      is_overdue: true,
      stock: 9,
      stock_name: 'Descaler tablets',
      stock_quantity: 0,
      stock_quantity_available: 0,
      stock_usage: 1,
    }
    server.use(
      http.get(`${BASE}/routines/1/`, () => HttpResponse.json(depletedRoutine)),
      // Stale stock list still carries severity='low' (orange).
      http.get(`${BASE}/stock/`, () =>
        HttpResponse.json([{ ...stockForLotSelection, id: 9, quantity: 1, stock_severity: 'low' }]),
      ),
    )
    renderDetail()
    const dot = await screen.findByTestId('stock-severity-dot')
    expect(dot.className).toContain('dotDanger')
    expect(dot.className).not.toContain('dotWarning')
  })
})
