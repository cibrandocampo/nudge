import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    owner_display_name: 'testuser',
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

  it('clicking the + button offline surfaces the offline toast and does not navigate', async () => {
    reachableRef.current = false
    mockStocks([])
    mockGroups([])
    const { user } = renderPage()
    const btn = await screen.findByRole('button', { name: '+ New' })
    await user.click(btn)
    // Toast text from `offline.pageUnavailable`.
    expect(await screen.findByText(/not available offline/i)).toBeInTheDocument()
    // The form route stub would render this text; absent ⇒ no navigation.
    expect(screen.queryByText('New product form')).not.toBeInTheDocument()
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
    // Two sections since T096: the group, and one for the ungrouped stock —
    // which used to render loose after every group and read as belonging to
    // the last one.
    expect(screen.getAllByTestId('group-box').map((b) => b.dataset.section)).toEqual(['10', 'ungrouped'])
    expect(screen.getByText('Water filter')).toBeInTheDocument()

    // Scoped to this group's own section: the name also labels its filter chip
    // (T093), and there is a second section for the ungrouped stock (T096).
    await user.click(
      within(document.querySelector('[data-testid="group-box"][data-section="10"]')).getByText('Medicine'),
    )
    expect(screen.queryByText('Ibuprofen')).not.toBeInTheDocument()
    // Ungrouped stock stays visible.
    expect(screen.getByText('Water filter')).toBeInTheDocument()
  })

  it('does not render empty group sections', async () => {
    mockStocks([stock({ group: null })])
    mockGroups([{ id: 10, name: 'Empty group', display_order: 0 }])
    renderPage()
    await screen.findByText('Water filter')
    // The empty group is absent; the ungrouped section that holds the stock
    // is not what this test is about.
    expect(document.querySelector('[data-testid="group-box"][data-section="10"]')).toBeNull()
  })
})

describe('InventoryPage — alert banner', () => {
  // The page owns whether the banner is mounted and what it is given; the
  // grouping rules themselves live in `stockAlerts.test.js` and the banner's
  // own behaviour in `InventoryAlertBanner.test.jsx`. These tests only cover
  // the seam between them.
  const PAST_DATE = '2026-04-20'

  it('does not render the banner when no stock has any severity', async () => {
    mockStocks([stock()])
    mockGroups([])
    renderPage()
    await screen.findByText('Water filter')
    expect(screen.queryByTestId('inventory-alert-banner')).not.toBeInTheDocument()
  })

  it('summarises every affected product in one collapsed banner', async () => {
    mockStocks([
      stock({ id: 1, name: 'Vitamin D', quantity: 0, quantity_available: 0, stock_severity: 'critical', lots: [] }),
      stock({ id: 2, name: 'Insulin', quantity: 10, stock_severity: 'low', estimated_depletion_date: '2026-05-15' }),
    ])
    mockGroups([])
    renderPage()
    const banner = await screen.findByTestId('inventory-alert-banner')
    expect(within(banner).getByText(/2 products need attention/i)).toBeInTheDocument()
    // Collapsed: the products are counted, not listed.
    expect(screen.queryByTestId('inventory-alert-row')).not.toBeInTheDocument()
  })

  it('counts a product with two problems once', async () => {
    // Critical (qty_available=0) AND a past-expiry lot. The four cards this
    // replaced listed it twice, in two separate red blocks.
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
    const banner = await screen.findByTestId('inventory-alert-banner')
    expect(within(banner).getByText(/1 product needs attention/i)).toBeInTheDocument()
  })

  it('opens onto one row per product, each linking to its detail page', async () => {
    mockStocks([
      stock({ id: 4, name: 'Aspirin', quantity: 0, quantity_available: 0, stock_severity: 'critical', lots: [] }),
    ])
    mockGroups([])
    const { user } = renderPage()
    await screen.findByTestId('inventory-alert-banner')
    await user.click(screen.getByRole('button', { name: /needs attention/i }))
    const row = screen.getByTestId('inventory-alert-row')
    expect(row).toHaveAttribute('href', '/inventory/4')
  })
})

describe('InventoryPage — search and filter', () => {
  const POPULATION = [
    stock({ id: 1, name: 'Insulin', group: 10, group_name: 'Diabetes', stock_severity: 'low' }),
    stock({ id: 2, name: 'Lancets', group: 10, group_name: 'Diabetes' }),
    stock({ id: 3, name: 'Aspirin', group: 20, group_name: 'Botiquin' }),
    stock({ id: 4, name: 'Loose item' }),
  ]
  const POPULATION_GROUPS = [
    { id: 10, name: 'Diabetes', display_order: 0 },
    { id: 20, name: 'Botiquin', display_order: 1 },
  ]

  const renderPopulated = () => {
    mockStocks(POPULATION)
    mockGroups(POPULATION_GROUPS)
    return renderPage()
  }

  // `vitest.config.js` keeps CSS module class names unscoped, so the row's
  // name element can be read directly. Group headers carry the same text as
  // their chip, which makes `getByText` ambiguous.
  const rowNames = () => screen.queryAllByTestId('product-card').map((row) => row.querySelector('.name').textContent)

  const chip = (id) => {
    const found = screen.getAllByTestId('stock-filter-chip').find((c) => c.dataset.chip === id)
    if (!found) throw new Error(`No filter chip "${id}" on screen`)
    return found
  }

  it('offers no search bar when there is nothing to search', async () => {
    mockStocks([])
    mockGroups([])
    renderPage()
    await screen.findByText(/no items yet/i)
    expect(screen.queryByTestId('stock-search')).not.toBeInTheDocument()
  })

  it('narrows the list as the query is typed, without a network call', async () => {
    let stockRequests = 0
    server.use(
      http.get(`${BASE}/stock/`, () => {
        stockRequests += 1
        return HttpResponse.json(POPULATION)
      }),
    )
    mockGroups(POPULATION_GROUPS)
    const { user } = renderPage()
    await screen.findByText('Insulin')
    const afterLoad = stockRequests

    await user.type(screen.getByTestId('stock-search'), 'lanc')
    expect(rowNames()).toEqual(['Lancets'])
    // The whole collection is already in the cache: filtering must not refetch.
    expect(stockRequests).toBe(afterLoad)
  })

  it('matches a batch number as well as a name', async () => {
    const { user } = renderPopulated()
    await screen.findByText('Insulin')

    await user.type(screen.getByTestId('stock-search'), 'lot-a')
    // Every fixture stock carries LOT-A, so this proves batch matching runs
    // rather than silently falling through to the name.
    expect(rowNames()).toHaveLength(4)
  })

  it('flattens the groups while filtering', async () => {
    const { user } = renderPopulated()
    await screen.findByText('Insulin')
    expect(screen.getAllByTestId('group-box').length).toBeGreaterThan(0)

    await user.type(screen.getByTestId('stock-search'), 'in')
    expect(screen.queryByTestId('group-box')).not.toBeInTheDocument()
    expect(rowNames()).toEqual(['Insulin', 'Aspirin'])
  })

  it('hides the alert banner while filtering', async () => {
    const { user } = renderPopulated()
    await screen.findByTestId('inventory-alert-banner')

    await user.click(chip('group-10'))
    expect(screen.queryByTestId('inventory-alert-banner')).not.toBeInTheDocument()
  })

  it('filters to a group when its chip is chosen', async () => {
    const { user } = renderPopulated()
    await screen.findByText('Insulin')

    await user.click(chip('group-10'))
    expect(rowNames()).toEqual(['Insulin', 'Lancets'])
  })

  it('filters to the products needing attention', async () => {
    const { user } = renderPopulated()
    await screen.findByText('Insulin')

    await user.click(chip('attention'))
    expect(rowNames()).toEqual(['Insulin'])
  })

  it('filters to the products with no category', async () => {
    const { user } = renderPopulated()
    await screen.findByText('Insulin')

    await user.click(chip('ungrouped'))
    expect(rowNames()).toEqual(['Loose item'])
  })

  it('shows a filtered empty state that can be cleared', async () => {
    const { user } = renderPopulated()
    await screen.findByText('Insulin')

    await user.type(screen.getByTestId('stock-search'), 'zzzzz')
    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument()
    // Not the "no items yet" copy: the user does have products.
    expect(screen.queryByText(/no items yet/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /clear filters/i }))
    expect(screen.getByTestId('stock-search')).toHaveValue('')
    expect(rowNames()).toEqual(['Insulin', 'Lancets', 'Aspirin', 'Loose item'])
  })

  it('restores groups and banner when the filter is cleared', async () => {
    const { user } = renderPopulated()
    await screen.findByText('Insulin')

    await user.click(chip('group-10'))
    expect(screen.queryByTestId('group-box')).not.toBeInTheDocument()

    await user.click(chip('all'))
    expect(screen.getAllByTestId('group-box').length).toBeGreaterThan(0)
    expect(screen.getByTestId('inventory-alert-banner')).toBeInTheDocument()
  })
})

describe('InventoryPage — pinned section', () => {
  const GROUPS = [{ id: 10, name: 'Diabetes', display_order: 0 }]

  const renderWith = (stocks) => {
    mockStocks(stocks)
    mockGroups(GROUPS)
    return renderPage()
  }

  const pinnedNames = () => {
    const section = screen.queryByTestId('pinned-section')
    if (!section) return null
    return within(section)
      .getAllByTestId('product-card')
      .map((row) => row.querySelector('.name').textContent)
  }

  it('is absent when nothing is pinned', async () => {
    renderWith([stock({ id: 1, name: 'Insulin', group: 10, is_pinned: false })])
    await screen.findByText('Insulin')
    expect(screen.queryByTestId('pinned-section')).not.toBeInTheDocument()
  })

  it('lists pinned products alphabetically', async () => {
    renderWith([
      stock({ id: 1, name: 'Zinc', group: 10, is_pinned: true }),
      stock({ id: 2, name: 'Aspirin', group: 10, is_pinned: true }),
      stock({ id: 3, name: 'Lancets', group: 10, is_pinned: false }),
    ])
    await screen.findByTestId('pinned-section')
    expect(pinnedNames()).toEqual(['Aspirin', 'Zinc'])
  })

  it('keeps a pinned product in its group as well', async () => {
    // Deliberate duplication: removing it from the group would make the
    // group's count wrong.
    renderWith([
      stock({ id: 1, name: 'Insulin', group: 10, group_name: 'Diabetes', is_pinned: true }),
      stock({ id: 2, name: 'Lancets', group: 10, group_name: 'Diabetes', is_pinned: false }),
    ])
    await screen.findByTestId('pinned-section')

    const group = screen.getByTestId('group-box')
    const inGroup = within(group)
      .getAllByTestId('product-card')
      .map((row) => row.querySelector('.name').textContent)
    expect(inGroup).toEqual(['Insulin', 'Lancets'])
    expect(within(group).getByText('(2)')).toBeInTheDocument()
    // Two rows on screen for the same product: one pinned, one in the group.
    expect(screen.getAllByText('Insulin')).toHaveLength(2)
  })

  it('never shows more than the cap, even if the cache holds more', async () => {
    renderWith(['A', 'B', 'C', 'D', 'E'].map((name, i) => stock({ id: i + 1, name, group: 10, is_pinned: true })))
    await screen.findByTestId('pinned-section')
    expect(pinnedNames()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('hides while a chip filter is active', async () => {
    const { user } = renderWith([
      stock({ id: 1, name: 'Insulin', group: 10, group_name: 'Diabetes', is_pinned: true, stock_severity: 'low' }),
    ])
    await screen.findByTestId('pinned-section')

    const chip = screen.getAllByTestId('stock-filter-chip').find((c) => c.dataset.chip === 'attention')
    await user.click(chip)
    expect(screen.queryByTestId('pinned-section')).not.toBeInTheDocument()
  })

  it('hides while a search is active, and comes back when cleared', async () => {
    const { user } = renderWith([stock({ id: 1, name: 'Insulin', group: 10, is_pinned: true })])
    await screen.findByTestId('pinned-section')

    await user.type(screen.getByTestId('stock-search'), 'ins')
    expect(screen.queryByTestId('pinned-section')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('stock-search-clear'))
    expect(screen.getByTestId('pinned-section')).toBeInTheDocument()
  })
})

describe('InventoryPage — sections, persistence and scroll', () => {
  const GROUPS = [
    { id: 10, name: 'Diabetes', display_order: 0 },
    { id: 20, name: 'Household', display_order: 1 },
  ]

  beforeEach(() => {
    localStorage.removeItem('inventory_collapsed_groups')
    sessionStorage.removeItem('inventory_scroll_y')
    // RTL's unmount can land either side of this hook, and unmounting writes
    // `window.scrollY` to storage. Pinning it to 0 makes that write harmless
    // whichever order the hooks run in — the same reasoning `setup.js` gives
    // for draining the offline queue in `beforeEach`.
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
  })

  // `vi.spyOn` returns the *existing* mock when one is already installed, so
  // an unrestored `window.scrollTo` spy carries its call history into the next
  // test and makes "was not called" assertions meaningless.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const renderWith = (stocks, groups = GROUPS) => {
    mockStocks(stocks)
    mockGroups(groups)
    return renderPage()
  }

  const section = (key) => document.querySelector(`[data-testid="group-box"][data-section="${key}"]`)

  it('gives ungrouped products a section of their own, last', async () => {
    renderWith([stock({ id: 1, name: 'Insulin', group: 10 }), stock({ id: 2, name: 'Loose item', group: null })])
    await screen.findByText('Insulin')

    const boxes = screen.getAllByTestId('group-box')
    expect(boxes.map((b) => b.dataset.section)).toEqual(['10', 'ungrouped'])
    expect(within(section('ungrouped')).getByText('No category')).toBeInTheDocument()
    expect(within(section('ungrouped')).getByText('(1)')).toBeInTheDocument()
  })

  it('omits the ungrouped section when every product has a group', async () => {
    renderWith([stock({ id: 1, name: 'Insulin', group: 10 })])
    await screen.findByText('Insulin')
    expect(section('ungrouped')).toBeNull()
  })

  it('treats a product in a group the viewer cannot see as ungrouped', async () => {
    // The group is per user, so a shared product routinely lands here.
    renderWith([stock({ id: 1, name: 'Shared thing', group: 999 })])
    await screen.findByText('Shared thing')
    expect(within(section('ungrouped')).getByText('Shared thing')).toBeInTheDocument()
  })

  it('remembers a collapsed section across an unmount', async () => {
    const stocks = [stock({ id: 1, name: 'Insulin', group: 10 })]
    const first = renderWith(stocks)
    await screen.findByText('Insulin')
    await first.user.click(within(section('10')).getByText('Diabetes'))
    expect(screen.queryByText('Insulin')).not.toBeInTheDocument()
    first.unmount()

    renderWith(stocks)
    // Not `findByText('Diabetes')`: the group's name labels its filter chip
    // too, so a bare text query matches twice.
    await screen.findByTestId('group-box')
    expect(screen.queryByText('Insulin')).not.toBeInTheDocument()
    expect(within(section('10')).getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders everything expanded when the stored preference is corrupt', async () => {
    localStorage.setItem('inventory_collapsed_groups', '{{{not json')
    renderWith([stock({ id: 1, name: 'Insulin', group: 10 })])
    expect(await screen.findByText('Insulin')).toBeInTheDocument()
  })

  it('forgets a section that no longer exists when another is collapsed', async () => {
    localStorage.setItem('inventory_collapsed_groups', JSON.stringify({ 99: true }))
    const { user } = renderWith([stock({ id: 1, name: 'Insulin', group: 10 })])
    await screen.findByText('Insulin')

    await user.click(within(section('10')).getByText('Diabetes'))
    expect(JSON.parse(localStorage.getItem('inventory_collapsed_groups'))).toEqual({ 10: true })
  })

  it('marks a section danger when anything inside is critical', async () => {
    renderWith([
      stock({ id: 1, name: 'Insulin', group: 10, stock_severity: 'critical' }),
      stock({ id: 2, name: 'Lancets', group: 10, stock_severity: 'ok' }),
    ])
    await screen.findByText('Insulin')
    expect(within(section('10')).getByTestId('group-severity-dot')).toHaveAttribute('data-severity', 'danger')
  })

  it('keeps the severity dot visible once the section is collapsed', async () => {
    // The whole point: folding a group must not hide that something is red.
    const { user } = renderWith([stock({ id: 1, name: 'Insulin', group: 10, stock_severity: 'critical' })])
    await screen.findByText('Insulin')

    await user.click(within(section('10')).getByText('Diabetes'))
    expect(screen.queryByText('Insulin')).not.toBeInTheDocument()
    expect(within(section('10')).getByTestId('group-severity-dot')).toHaveAttribute('data-severity', 'danger')
  })

  it('marks a section warning when the worst inside is amber', async () => {
    renderWith([stock({ id: 1, name: 'Insulin', group: 10, expiry_severity: 'soon' })])
    await screen.findByText('Insulin')
    expect(within(section('10')).getByTestId('group-severity-dot')).toHaveAttribute('data-severity', 'warning')
  })

  it('shows no dot when everything in the section is healthy', async () => {
    renderWith([stock({ id: 1, name: 'Insulin', group: 10 })])
    await screen.findByText('Insulin')
    expect(within(section('10')).queryByTestId('group-severity-dot')).not.toBeInTheDocument()
  })

  it('restores the scroll position it saved on unmount', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const stocks = [stock({ id: 1, name: 'Insulin', group: 10 })]
    const first = renderWith(stocks)
    await screen.findByText('Insulin')

    // The page tracks scrolling through a listener, so the value has to be
    // observed while mounted — reading it at unmount is too late in a real
    // browser, which is what this mirrors.
    Object.defineProperty(window, 'scrollY', { value: 620, configurable: true })
    window.dispatchEvent(new Event('scroll'))
    first.unmount()
    expect(sessionStorage.getItem('inventory_scroll_y')).toBe('620')

    scrollTo.mockClear()
    renderWith(stocks)
    await screen.findByText('Insulin')
    expect(scrollTo).toHaveBeenCalledWith(0, 620)
  })

  it('does not scroll when there is no saved position', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    renderWith([stock({ id: 1, name: 'Insulin', group: 10 })])
    await screen.findByText('Insulin')
    expect(scrollTo).not.toHaveBeenCalled()
  })
})

describe('InventoryPage — sticky offset and scroll guard', () => {
  const GROUPS = [{ id: 10, name: 'Diabetes', display_order: 0 }]

  afterEach(() => {
    delete window.ResizeObserver
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('publishes the search bar height so section headers can stick under it', async () => {
    // jsdom has no ResizeObserver, so the effect bails out and the mechanism
    // that keeps the two sticky layers apart would go untested.
    let notify
    window.ResizeObserver = class {
      constructor(cb) {
        notify = cb
      }
      observe() {}
      disconnect() {}
    }
    // Border-box height, which is what the effect must read: `contentRect`
    // would omit the bar's padding and let headers slide under it.
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ height: 88 })

    mockStocks([stock({ id: 1, name: 'Insulin', group: 10 })])
    mockGroups(GROUPS)
    const { container } = renderPage()
    await screen.findByText('Insulin')

    act(() => notify())
    expect(container.firstChild).toHaveStyle({ '--inventory-bar-h': '88px' })
    rect.mockRestore()
  })

  it('ignores the reset-to-top scroll that fires once the route has changed', async () => {
    mockStocks([stock({ id: 1, name: 'Insulin', group: 10 })])
    mockGroups(GROUPS)
    const { unmount } = renderPage()
    await screen.findByText('Insulin')

    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true })
    window.dispatchEvent(new Event('scroll'))

    // Navigating away fires a scroll to 0 *after* the URL has changed. Without
    // the route guard that event overwrites the tracked offset and the user
    // returns to the top.
    window.history.pushState({}, '', '/inventory/42')
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    window.dispatchEvent(new Event('scroll'))

    unmount()
    expect(sessionStorage.getItem('inventory_scroll_y')).toBe('500')
    window.history.pushState({}, '', '/')
  })
})
