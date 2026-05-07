import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import InventoryPage from '../InventoryPage'

const reachableRef = { current: true }
vi.mock('../../hooks/useServerReachable', () => ({
  useServerReachable: () => reachableRef.current,
}))

const BASE = 'http://localhost/api'

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/inventory" element={<InventoryPage />} />
      <Route path="/inventory/new" element={<div>New product form</div>} />
      <Route path="/inventory/groups" element={<div>Groups page</div>} />
      <Route path="/inventory/:id" element={<div>Detail stub</div>} />
    </Routes>,
    { initialEntries: ['/inventory'] },
  )
}

function mockStocks(stocks) {
  server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json(stocks)))
}

function mockGroups(groups) {
  server.use(http.get(`${BASE}/stock-groups/`, () => HttpResponse.json(groups ?? [])))
}

function stock(overrides = {}) {
  return {
    id: 1,
    name: 'Water filter',
    quantity: 5,
    group: null,
    estimated_depletion_date: null,
    daily_consumption_own: null,
    daily_consumption_shared: null,
    stock_severity: 'ok',
    expiry_severity: 'ok',
    lots: [{ id: 10, quantity: 5, expiry_date: null, lot_number: 'LOT-A', updated_at: '2026-04-17T10:00:00Z' }],
    shared_with: [],
    shared_with_details: [],
    is_owner: true,
    owner_username: 'testuser',
    updated_at: '2026-04-17T10:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  reachableRef.current = true
})

describe('InventoryPage — loading & empty states', () => {
  it('shows loading state initially', () => {
    renderPage()
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
  })

  it('shows the empty state when there are no stocks', async () => {
    mockStocks([])
    mockGroups([])
    renderPage()
    await waitFor(() => expect(screen.getByText(/no items yet/i)).toBeInTheDocument())
  })
})

describe('InventoryPage — top-bar navigation', () => {
  it('navigates to /inventory/new when the + button is clicked', async () => {
    mockStocks([])
    mockGroups([])
    const { user } = renderPage()

    const newBtn = await screen.findByRole('button', { name: '+ New' })
    await user.click(newBtn)
    expect(await screen.findByText('New product form')).toBeInTheDocument()
  })

  it('navigates to /inventory/groups when the Categories icon-button is clicked', async () => {
    mockStocks([])
    mockGroups([])
    const { user } = renderPage()

    const groupsBtn = await screen.findByRole('button', { name: 'Categories' })
    await user.click(groupsBtn)
    expect(await screen.findByText('Groups page')).toBeInTheDocument()
  })

  it('marks the + button as aria-disabled offline', async () => {
    reachableRef.current = false
    mockStocks([])
    mockGroups([])
    renderPage()
    const btn = await screen.findByRole('button', { name: '+ New' })
    // Not `disabled` — the click handler fires the offline toast.
    expect(btn).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('InventoryPage — stock cards', () => {
  it('renders product cards', async () => {
    mockStocks([stock({ id: 1, name: 'Water filter' }), stock({ id: 2, name: 'Vitamin D' })])
    mockGroups([])
    renderPage()
    await waitFor(() => expect(screen.getByText('Water filter')).toBeInTheDocument())
    expect(screen.getByText('Vitamin D')).toBeInTheDocument()
  })

  it('navigates to detail when the Open-details chevron is clicked', async () => {
    mockStocks([stock()])
    mockGroups([])
    const { user } = renderPage()
    await screen.findByText('Water filter')

    await user.click(screen.getByLabelText('Open details'))
    expect(await screen.findByText('Detail stub')).toBeInTheDocument()
  })

  it('hides the −1 consume button when quantity is 0', async () => {
    mockStocks([stock({ quantity: 0, lots: [] })])
    mockGroups([])
    renderPage()
    await screen.findByText('Water filter')
    expect(screen.queryByLabelText('Consume 1 unit')).not.toBeInTheDocument()
  })

  it('shows the shared badge (no click) when the stock is shared by the owner', async () => {
    mockStocks([stock({ shared_with: [2], is_owner: true })])
    mockGroups([])
    renderPage()
    await screen.findByText('Water filter')
    const badge = screen.getByTestId('shared-badge')
    expect(badge).toBeInTheDocument()
    expect(badge.tagName).toBe('SPAN')
  })
})

describe('InventoryPage — −1 lot picker', () => {
  it('opens LotPickerModal when the −1 button is clicked', async () => {
    mockStocks([stock()])
    mockGroups([])
    const { user } = renderPage()
    await screen.findByText('Water filter')

    await user.click(screen.getByLabelText('Consume 1 unit'))
    // The modal is a dialog — its title confirms it's the picker.
    expect(await screen.findByText(/consume 1 unit/i)).toBeInTheDocument()
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0)
  })

  it('confirming consumes via /stock/:id/consume/ and closes the modal', async () => {
    let consumeBody = null
    mockStocks([
      stock({
        lots: [
          { id: 10, quantity: 3, expiry_date: '2027-01-01', lot_number: 'LOT-A' },
          { id: 11, quantity: 2, expiry_date: '2028-01-01', lot_number: 'LOT-B' },
        ],
      }),
    ])
    mockGroups([])
    server.use(
      http.post(`${BASE}/stock/1/consume/`, async ({ request }) => {
        consumeBody = await request.json()
        return HttpResponse.json({ ...stock(), quantity: 4 })
      }),
    )

    const { user } = renderPage()
    await screen.findByText('Water filter')
    await user.click(screen.getByLabelText('Consume 1 unit'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /consume 1/i }))

    await waitFor(() => expect(consumeBody).not.toBeNull())
    expect(consumeBody.quantity).toBe(1)
    expect(consumeBody.lot_selections).toEqual([{ lot_id: 10, quantity: 1 }])
  })

  it('shows an error toast and does not open the picker when the stock has no lots', async () => {
    // Defensive guard: the card hides the −1 button when quantity is 0, but
    // backend drift could surface a stock whose quantity > 0 yet whose lots
    // array is empty. In that case handleConsume short-circuits to a toast.
    mockStocks([stock({ lots: [] })])
    mockGroups([])
    const { user } = renderPage()
    await screen.findByText('Water filter')

    await user.click(screen.getByLabelText('Consume 1 unit'))
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cancelling the modal does not consume', async () => {
    let consumeCalls = 0
    mockStocks([stock()])
    mockGroups([])
    server.use(
      http.post(`${BASE}/stock/1/consume/`, () => {
        consumeCalls += 1
        return HttpResponse.json({})
      }),
    )

    const { user } = renderPage()
    await screen.findByText('Water filter')
    await user.click(screen.getByLabelText('Consume 1 unit'))
    await user.click(await screen.findByRole('button', { name: /cancel/i }))

    // Modal closed
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(consumeCalls).toBe(0)
  })
})

describe('InventoryPage — grouping', () => {
  it('renders stocks grouped by category with collapsible sections', async () => {
    mockStocks([
      stock({ id: 1, name: 'Ibuprofen', group: 10 }),
      stock({ id: 2, name: 'Vitamin D', group: 10 }),
      stock({ id: 3, name: 'Water filter', group: null }),
    ])
    mockGroups([{ id: 10, name: 'Medicine', display_order: 0 }])
    const { user } = renderPage()

    await waitFor(() => expect(screen.getByText('Ibuprofen')).toBeInTheDocument())
    expect(screen.getAllByTestId('group-box').length).toBe(1)
    // Ungrouped stock renders outside the group box.
    expect(screen.getByText('Water filter')).toBeInTheDocument()

    // Collapse the group.
    await user.click(screen.getByText('Medicine'))
    expect(screen.queryByText('Ibuprofen')).not.toBeInTheDocument()
    // Ungrouped stock stays visible.
    expect(screen.getByText('Water filter')).toBeInTheDocument()
  })

  it('does not render empty group sections', async () => {
    mockStocks([stock({ group: null })])
    mockGroups([{ id: 10, name: 'Empty group', display_order: 0 }])
    renderPage()
    await screen.findByText('Water filter')
    expect(screen.queryByTestId('group-box')).not.toBeInTheDocument()
  })
})

describe('InventoryPage — alerts (4 severity-driven blocks)', () => {
  // Today is 2026-04-27 in the test runner's clock. The alerts derive
  // reached / soon buckets from `stock.lots` via `lotExpirySeverity`:
  //   expiry_date <= today                → 'reached' (red alert)
  //   today < expiry_date < today + 30d   → 'soon' (orange alert)
  const PAST_DATE = '2026-04-20'
  const FUTURE_DATE = '2026-05-15'

  it('does not render the alert section when no stock has any severity', async () => {
    mockStocks([stock()])
    mockGroups([])
    renderPage()
    await screen.findByText('Water filter')
    expect(screen.queryByTestId('alert-box')).not.toBeInTheDocument()
  })

  it('renders the critical-stock alert with the qty × name format', async () => {
    mockStocks([
      stock({
        id: 1,
        name: 'Vitamin D',
        quantity: 0,
        quantity_available: 0,
        stock_severity: 'critical',
        lots: [],
      }),
    ])
    mockGroups([])
    renderPage()
    const alert = await screen.findByTestId('critical-stock-alert')
    expect(alert).toBeInTheDocument()
    // Format mirrors the other alerts: `{{qty}} × {{name}}` so the user sees
    // unambiguously how many usable units are left (qty_available, can be 0).
    expect(within(alert).getByText(/0 × Vitamin D/i)).toBeInTheDocument()
    expect(within(alert).getByText(/critical stock/i)).toBeInTheDocument()
  })

  it('renders the expiry-reached alert with each expired lot', async () => {
    mockStocks([
      stock({
        id: 1,
        name: 'Aspirin',
        expiry_severity: 'reached',
        lots: [{ id: 10, quantity: 4, expiry_date: PAST_DATE, lot_number: '' }],
      }),
    ])
    mockGroups([])
    renderPage()
    const alert = await screen.findByTestId('expiry-reached-alert')
    expect(within(alert).getByText(/expiry reached/i)).toBeInTheDocument()
    expect(within(alert).getByText(/4 × Aspirin/i)).toBeInTheDocument()
    expect(within(alert).getByText(/\(expired /i)).toBeInTheDocument()
  })

  it('renders the low-stock alert with the (until) suffix when depletion date is known', async () => {
    mockStocks([
      stock({
        id: 1,
        name: 'Insulin',
        quantity: 10,
        stock_severity: 'low',
        estimated_depletion_date: '2026-05-15',
      }),
    ])
    mockGroups([])
    renderPage()
    const alert = await screen.findByTestId('low-stock-alert')
    expect(within(alert).getByText(/low stock/i)).toBeInTheDocument()
    // Format follows the RoutineCard stock badge: "{qty} × {name} (until {date})".
    expect(within(alert).getByText(/10 × Insulin/i)).toBeInTheDocument()
    expect(within(alert).getByText(/\(until /i)).toBeInTheDocument()
  })

  it('renders the low-stock alert without suffix when no depletion date is available', async () => {
    mockStocks([
      stock({
        id: 1,
        name: 'Bandages',
        quantity: 2,
        stock_severity: 'low',
        estimated_depletion_date: null,
      }),
    ])
    mockGroups([])
    renderPage()
    const alert = await screen.findByTestId('low-stock-alert')
    expect(within(alert).getByText('2 × Bandages')).toBeInTheDocument()
    expect(within(alert).queryByText(/\(until /i)).not.toBeInTheDocument()
  })

  it('renders the expiring-soon alert with each near-future lot', async () => {
    mockStocks([
      stock({
        id: 1,
        name: 'Vitamin D',
        expiry_severity: 'soon',
        lots: [{ id: 10, quantity: 7, expiry_date: FUTURE_DATE, lot_number: '' }],
      }),
    ])
    mockGroups([])
    renderPage()
    const alert = await screen.findByTestId('expiring-soon-alert')
    expect(within(alert).getByText(/expiring soon/i)).toBeInTheDocument()
    expect(within(alert).getByText(/7 × Vitamin D/i)).toBeInTheDocument()
    expect(within(alert).getByText(/\(expires /i)).toBeInTheDocument()
  })

  it('lists a stock in both blocks when it qualifies for two orthogonal severities', async () => {
    // critical (qty_available=0) AND a past-expiry lot (reached) → appears in both red blocks.
    mockStocks([
      stock({
        id: 1,
        name: 'Ibuprofen',
        quantity: 0,
        quantity_available: 0,
        stock_severity: 'critical',
        expiry_severity: 'reached',
        lots: [{ id: 99, quantity: 1, expiry_date: PAST_DATE, lot_number: '' }],
      }),
    ])
    mockGroups([])
    renderPage()
    const critical = await screen.findByTestId('critical-stock-alert')
    const reached = await screen.findByTestId('expiry-reached-alert')
    expect(within(critical).getByText(/0 × Ibuprofen/i)).toBeInTheDocument()
    expect(within(reached).getByText(/Ibuprofen/)).toBeInTheDocument()
  })

  it('shows only the reached block when expiry_severity is reached, even with future lots present', async () => {
    // T170: alert visibility is gated by `expiry_severity` (backend), but the
    // ITEMS inside each block are derived from `stock.lots` via the local
    // `lotsByExpirySeverity` helper. Backend awarded 'reached' precedence
    // (one lot already expired), so the soon block stays hidden — even
    // though the lots array still contains a future lot.
    mockStocks([
      stock({
        id: 1,
        name: 'Mixed',
        expiry_severity: 'reached',
        lots: [
          { id: 1, quantity: 1, expiry_date: PAST_DATE, lot_number: '' },
          { id: 2, quantity: 2, expiry_date: FUTURE_DATE, lot_number: '' },
        ],
      }),
    ])
    mockGroups([])
    renderPage()
    const reached = await screen.findByTestId('expiry-reached-alert')
    expect(within(reached).getByText(/1 × Mixed/i)).toBeInTheDocument()
    // Backend awarded 'reached' precedence — the soon block stays hidden.
    expect(screen.queryByTestId('expiring-soon-alert')).not.toBeInTheDocument()
  })
})
