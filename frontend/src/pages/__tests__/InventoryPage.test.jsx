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

const chipButton = (id) => screen.getAllByTestId('stock-filter-chip').find((chip) => chip.dataset.chip === id)
const rowNames = (list) =>
  within(list)
    .getAllByTestId('product-card')
    .map((row) => row.querySelector('[class*="name"]').textContent)

beforeEach(() => {
  sessionStorage.clear()
  localStorage.removeItem('inventory_collapsed_groups')
})

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
    my_groups: [],
    is_pinned: false,
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
  it('opens LotPickerModal when there is more than one lot to choose from', async () => {
    mockStocks([
      stock({
        lots: [
          { id: 10, quantity: 3, expiry_date: '2099-01-01', lot_number: 'LOT-A' },
          { id: 11, quantity: 2, expiry_date: '2100-01-01', lot_number: 'LOT-B' },
        ],
      }),
    ])
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
          { id: 10, quantity: 3, expiry_date: '2099-01-01', lot_number: 'LOT-A' },
          { id: 11, quantity: 2, expiry_date: '2100-01-01', lot_number: 'LOT-B' },
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

  it('after a 422 lot_unavailable the open picker stops offering the batch that is gone', async () => {
    // Stateful: the refused consume flips `gone`, and the refetch it triggers
    // returns the stock without LOT-A, as the server now has it.
    let gone = false
    const lotA = { id: 10, quantity: 1, expiry_date: '2099-01-01', lot_number: 'LOT-A' }
    const lotB = { id: 11, quantity: 2, expiry_date: '2100-01-01', lot_number: 'LOT-B' }
    mockGroups([])
    server.use(
      http.get(`${BASE}/stock/`, () => HttpResponse.json([stock({ lots: gone ? [lotB] : [lotA, lotB] })])),
      http.post(`${BASE}/stock/1/consume/`, () => {
        gone = true
        return HttpResponse.json(
          { detail: 'Lot no longer available.', code: 'lot_unavailable', lot_ids: [10] },
          { status: 422 },
        )
      }),
    )

    const { user } = renderPage()
    await screen.findByText('Water filter')
    await user.click(screen.getByLabelText('Consume 1 unit'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('LOT-A')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /consume 1/i }))

    expect(await within(dialog).findByText('This batch is no longer available.')).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).queryByText('LOT-A')).not.toBeInTheDocument())
    expect(within(dialog).getByText('LOT-B')).toBeInTheDocument()
  })

  it('keeps the picker on the row it opened with when that stock leaves the list', async () => {
    // E.g. the owner deleted the stock meanwhile: the refetch after the refusal
    // no longer has it, and the open picker must not lose its content.
    let gone = false
    mockGroups([])
    server.use(
      http.get(`${BASE}/stock/`, () =>
        HttpResponse.json(
          gone
            ? []
            : [
                stock({
                  lots: [
                    { id: 10, quantity: 3, expiry_date: '2099-01-01', lot_number: 'LOT-A' },
                    { id: 11, quantity: 2, expiry_date: '2100-01-01', lot_number: 'LOT-B' },
                  ],
                }),
              ],
        ),
      ),
      http.post(`${BASE}/stock/1/consume/`, () => {
        gone = true
        return HttpResponse.json({ detail: 'Not found.' }, { status: 404 })
      }),
    )

    const { user } = renderPage()
    await screen.findByText('Water filter')
    await user.click(screen.getByLabelText('Consume 1 unit'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /consume 1/i }))

    expect(await within(dialog).findByText('Not found.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('product-card')).not.toBeInTheDocument())
    expect(within(dialog).getByText('LOT-A')).toBeInTheDocument()
  })

  it('consumes directly, with Undo, when there is a single lot', async () => {
    let consumeBody = null
    mockStocks([stock()])
    mockGroups([])
    server.use(
      http.post(`${BASE}/stock/1/consume/`, async ({ request }) => {
        consumeBody = await request.json()
        return HttpResponse.json({ ...stock(), quantity: 4, consumption_id: 5 })
      }),
    )
    const { user } = renderPage()
    await screen.findByText('Water filter')
    await user.click(screen.getByLabelText('Consume 1 unit'))

    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(consumeBody.lot_selections).toBeUndefined()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('refuses without opening the picker when the stock has no lots', async () => {
    // Backend drift could surface a quantity > 0 with an empty lots array.
    mockStocks([stock({ lots: [] })])
    mockGroups([])
    const { user } = renderPage()
    await screen.findByText('Water filter')

    await user.click(screen.getByLabelText('Consume 1 unit'))
    expect(await screen.findByText('Not enough stock (1 needed, 0 available).')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cancelling the modal does not consume', async () => {
    let consumeCalls = 0
    mockStocks([
      stock({
        lots: [
          { id: 10, quantity: 3, expiry_date: '2099-01-01', lot_number: 'LOT-A' },
          { id: 11, quantity: 2, expiry_date: '2100-01-01', lot_number: 'LOT-B' },
        ],
      }),
    ])
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

describe('InventoryPage — one list', () => {
  it('lists every product alphabetically in one card', async () => {
    mockStocks([stock({ id: 1, name: 'Vitamin D' }), stock({ id: 2, name: 'Aspirin' })])
    mockGroups([])
    renderPage()
    const list = await screen.findByTestId('inventory-list')
    expect(rowNames(list)).toEqual(['Aspirin', 'Vitamin D'])
  })

  it('shows a product in two categories only once', async () => {
    mockStocks([stock({ my_groups: [10, 20], is_pinned: true })])
    mockGroups([
      { id: 10, name: 'Medicine', display_order: 0 },
      { id: 20, name: 'Travel', display_order: 1 },
    ])
    const { user } = renderPage()
    await screen.findByTestId('inventory-list')
    await user.click(chipButton('all'))
    expect(screen.getAllByTestId('product-card')).toHaveLength(1)
  })
})

describe('InventoryPage — default view', () => {
  it('opens on Featured, showing nothing else', async () => {
    mockStocks([stock({ id: 1, name: 'Insulin', is_pinned: true }), stock({ id: 2, name: 'Aspirin' })])
    mockGroups([])
    renderPage()
    const list = await screen.findByTestId('inventory-list')
    expect(rowNames(list)).toEqual(['Insulin'])
    expect(chipButton('featured')).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens on All when nothing is featured', async () => {
    mockStocks([stock({ id: 2, name: 'Aspirin' })])
    mockGroups([])
    renderPage()
    await screen.findByText('Aspirin')
    expect(chipButton('all')).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps Attention on offer from the default view', async () => {
    mockStocks([stock({ id: 1, name: 'Insulin', is_pinned: true }), stock({ id: 2, stock_severity: 'critical' })])
    mockGroups([])
    renderPage()
    await screen.findByTestId('inventory-list')
    expect(chipButton('attention')).toHaveTextContent('1')
  })

  it('restores the chosen filter on coming back', async () => {
    const stocks = [stock({ id: 1, name: 'Insulin', is_pinned: true }), stock({ id: 2, name: 'Aspirin' })]
    mockStocks(stocks)
    mockGroups([])
    const first = renderPage()
    await screen.findByTestId('inventory-list')
    await first.user.click(chipButton('all'))
    first.unmount()

    renderPage()
    const list = await screen.findByTestId('inventory-list')
    expect(rowNames(list)).toEqual(['Aspirin', 'Insulin'])
  })

  it('falls back to All when the chosen category is gone', async () => {
    sessionStorage.setItem('inventory_filter', 'group-99')
    mockStocks([stock({ id: 2, name: 'Aspirin' })])
    mockGroups([])
    renderPage()
    await screen.findByText('Aspirin')
    expect(chipButton('all')).toHaveAttribute('aria-pressed', 'true')
  })

  it('with nothing needing attention, says so and offers the way back', async () => {
    mockStocks([stock({ id: 2, name: 'Aspirin' })])
    mockGroups([])
    const { user } = renderPage()
    await screen.findByText('Aspirin')
    await user.click(chipButton('attention'))
    expect(await screen.findByText('All in order')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(await screen.findByText('Aspirin')).toBeInTheDocument()
  })

  it('forgets the folded sections of the old list', async () => {
    localStorage.setItem('inventory_collapsed_groups', '{"10":true}')
    mockStocks([stock()])
    mockGroups([])
    renderPage()
    await screen.findByText('Water filter')
    expect(localStorage.getItem('inventory_collapsed_groups')).toBeNull()
  })
})

describe('InventoryPage — attention on the rows', () => {
  // No summary banner: the Atención chip filters, and each row says why. The
  // reasons themselves are `stockRowReasons` (stockAlerts.test.js) and their
  // rendering StockRow's; this covers the page.
  it('shows no "products need attention" banner', async () => {
    mockStocks([stock({ id: 1, name: 'Vitamin D', quantity: 0, quantity_available: 0, stock_severity: 'critical' })])
    mockGroups([])
    renderPage()
    await screen.findByText('Vitamin D')
    expect(screen.queryByText(/need(s)? attention/i)).not.toBeInTheDocument()
  })

  it('each product the Atención chip selects says why on its own row', async () => {
    mockStocks([
      stock({ id: 1, name: 'Vitamin D', quantity: 0, quantity_available: 0, stock_severity: 'critical' }),
      stock({ id: 2, name: 'Insulin', quantity: 10, stock_severity: 'low' }),
      stock({ id: 3, name: 'Ibuprofen', expiry_severity: 'reached' }),
      stock({ id: 4, name: 'Water filter' }),
    ])
    mockGroups([])
    const { user } = renderPage()
    await screen.findByText('Insulin')
    await user.click(chipButton('attention'))

    const rows = screen.getAllByTestId('product-card')
    expect(rows.map((r) => within(r).getByText(/^(Vitamin D|Insulin|Ibuprofen)$/).textContent)).toEqual([
      'Ibuprofen',
      'Insulin',
      'Vitamin D',
    ])
    const [ibuprofen, insulin, vitamin] = rows
    expect(within(vitamin).getByTestId('row-quantity')).toHaveAttribute('data-out-of-stock', 'true')
    expect(within(insulin).getByTestId('row-reason')).toHaveTextContent('low stock')
    expect(within(ibuprofen).getByTestId('row-reason')).toHaveTextContent('expired')
  })
})

describe('InventoryPage — search and filter', () => {
  const POPULATION = [
    stock({ id: 1, name: 'Insulin', my_groups: [10], stock_severity: 'low' }),
    stock({ id: 2, name: 'Lancets', my_groups: [10] }),
    stock({ id: 3, name: 'Aspirin', my_groups: [20] }),
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

  it('filters to a category when its chip is chosen', async () => {
    const { user } = renderPopulated()
    await screen.findByText('Insulin')
    await user.click(chipButton('group-10'))
    expect(rowNames(screen.getByTestId('inventory-list'))).toEqual(['Insulin', 'Lancets'])
  })

  it('filters to the products needing attention', async () => {
    const { user } = renderPopulated()
    await screen.findByText('Insulin')
    await user.click(chipButton('attention'))
    expect(rowNames(screen.getByTestId('inventory-list'))).toEqual(['Insulin'])
  })

  it('filters to the products with no category', async () => {
    const { user } = renderPopulated()
    await screen.findByText('Insulin')
    await user.click(chipButton('ungrouped'))
    expect(rowNames(screen.getByTestId('inventory-list'))).toEqual(['Loose item'])
  })

  it('searches everything from a narrower filter, and returns to it when cleared', async () => {
    const { user } = renderPopulated()
    await screen.findByText('Insulin')
    await user.click(chipButton('group-20'))
    await user.type(screen.getByTestId('stock-search'), 'insulin')
    expect(rowNames(screen.getByTestId('inventory-list'))).toEqual(['Insulin'])
    expect(chipButton('group-20')).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByTestId('stock-search-clear'))
    expect(rowNames(screen.getByTestId('inventory-list'))).toEqual(['Aspirin'])
  })

  it('choosing a filter clears the text', async () => {
    const { user } = renderPopulated()
    await screen.findByText('Insulin')
    await user.type(screen.getByTestId('stock-search'), 'insulin')
    await user.click(chipButton('group-20'))
    expect(screen.getByTestId('stock-search')).toHaveValue('')
    expect(rowNames(screen.getByTestId('inventory-list'))).toEqual(['Aspirin'])
  })

  it('a search with no matches can be cleared', async () => {
    const { user } = renderPopulated()
    await screen.findByText('Insulin')
    await user.type(screen.getByTestId('stock-search'), 'zzz')
    await user.click(await screen.findByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByText('Insulin')).toBeInTheDocument()
  })
})

describe('InventoryPage — scroll', () => {
  const renderWith = (stocks) => {
    mockStocks(stocks)
    mockGroups([])
    return renderPage()
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('restores the scroll position it saved on unmount', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const stocks = [stock({ id: 1, name: 'Insulin' })]
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
    renderWith([stock({ id: 1, name: 'Insulin' })])
    await screen.findByText('Insulin')
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('choosing a filter goes back to the top', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const { user } = renderWith([stock({ id: 1, name: 'Insulin' })])
    await screen.findByText('Insulin')
    await user.click(chipButton('attention'))
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('does not restore a position saved from a search', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const { user, unmount } = renderWith([stock({ id: 1, name: 'Insulin' })])
    await screen.findByText('Insulin')
    await user.type(screen.getByTestId('stock-search'), 'ins')
    Object.defineProperty(window, 'scrollY', { value: 300, configurable: true })
    window.dispatchEvent(new Event('scroll'))
    unmount()
    expect(sessionStorage.getItem('inventory_scroll_y')).toBe('0')
  })
})

describe('InventoryPage — scroll guard', () => {
  const GROUPS = [{ id: 10, name: 'Diabetes', display_order: 0 }]

  afterEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('ignores the reset-to-top scroll that fires once the route has changed', async () => {
    mockStocks([stock({ id: 1, name: 'Insulin' })])
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

describe('InventoryPage — empty state action (T156)', () => {
  afterEach(() => {
    reachableRef.current = true
  })

  it('with no products, offers to add one', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([])))
    renderWithProviders(<InventoryPage />)
    expect(await screen.findByRole('link', { name: 'Add product' })).toHaveAttribute('href', '/inventory/new')
  })

  it('offline, the action says why it cannot be used', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([])))
    reachableRef.current = false
    const { user } = renderWithProviders(<InventoryPage />)
    const action = await screen.findByRole('button', { name: 'Add product' })
    expect(action).toHaveAttribute('aria-disabled', 'true')
    await user.click(action)
    expect(await screen.findByText('This section is not available offline.')).toBeInTheDocument()
  })
})
