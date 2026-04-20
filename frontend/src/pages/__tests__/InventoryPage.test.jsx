import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { mockNetworkError } from '../../test/mocks/handlers'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import { clear, list } from '../../offline/queue'
import InventoryPage from '../InventoryPage'

const reachableRef = { current: true }
vi.mock('../../hooks/useServerReachable', () => ({
  useServerReachable: () => reachableRef.current,
}))

const BASE = 'http://localhost/api'

const stockItem = {
  id: 1,
  name: 'Water filters',
  quantity: 10,
  group: null,
  group_name: null,
  has_expiring_lots: false,
  expiring_lots: [],
  requires_lot_selection: false,
  estimated_depletion_date: null,
  daily_consumption_own: null,
  daily_consumption_shared: null,
  is_low_stock: false,
  lots: [
    { id: 100, quantity: 5, expiry_date: '2025-06-01', lot_number: 'LOT-A' },
    { id: 101, quantity: 5, expiry_date: null, lot_number: '' },
  ],
}

const stockWithLots = {
  ...stockItem,
  requires_lot_selection: true,
  lots: [{ id: 100, quantity: 5, expiry_date: '2027-01-01', lot_number: 'LOT-A' }],
}

const emptyStock = { ...stockItem, quantity: 0, lots: [] }

describe('InventoryPage', () => {
  it('shows loading state initially', () => {
    renderWithProviders(<InventoryPage />)
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
  })

  it('shows empty state when no stocks', async () => {
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText(/No items yet/)).toBeInTheDocument())
  })

  it('renders product cards', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([stockItem])))
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Water filters')).toBeInTheDocument())
    expect(screen.getByText('(10 total)')).toBeInTheDocument()
  })

  it('renders lots within a product card', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([stockItem])))
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('LOT-A')).toBeInTheDocument())
    expect(screen.getByText('No expiry')).toBeInTheDocument()
  })

  it('shows error when create stock fails', async () => {
    server.use(http.post(`${BASE}/stock/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderWithProviders(<InventoryPage />)
    const addBtn = await screen.findByRole('button', { name: '+ New' })

    await user.click(addBtn)
    const input = screen.getByPlaceholderText('Item name (e.g. Water filters)')
    await user.type(input, 'Bad Item')
    await user.click(screen.getByText('Create item'))

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('shows + New button and creates stock', async () => {
    const { user } = renderWithProviders(<InventoryPage />)
    const addBtn = await screen.findByRole('button', { name: '+ New' })

    await user.click(addBtn)
    const input = screen.getByPlaceholderText('Item name (e.g. Water filters)')
    await user.type(input, 'New Item')
    await user.click(screen.getByText('Create item'))

    await waitFor(() => expect(screen.getByText('New Item')).toBeInTheDocument())
  })

  // The card-level "Delete stock" button moves to StockDetailPage in T048.
  // See docs/plans/ui-design-system-alignment.md.
  it.skip('confirms and deletes a stock item', () => {})

  it('opens add lot form and submits', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([{ ...stockItem, lots: [] }])))
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('+ Add batch')).toBeInTheDocument())

    await user.click(screen.getByText('+ Add batch'))
    const qtyInput = screen.getByPlaceholderText('0')
    await user.type(qtyInput, '5')
    await user.click(screen.getByText('Add batch'))

    await waitFor(() => expect(screen.queryByPlaceholderText('0')).not.toBeInTheDocument())
  })

  it('confirms and deletes a lot', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([stockItem])))
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('LOT-A')).toBeInTheDocument())

    // Only lot deletes remain on the card (stock delete moved to StockDetailPage in T048)
    const lotDeleteBtns = screen.getAllByTitle('Delete')
    await user.click(lotDeleteBtns[0])
    expect(screen.getByText('Delete this batch?')).toBeInTheDocument()

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByText('Delete'))
  })

  it('shows expiring soon alert', async () => {
    const expiringStock = {
      ...stockItem,
      has_expiring_lots: true,
      expiring_lots: [{ id: 100, quantity: 5, expiry_date: '2025-06-01' }],
    }
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([expiringStock])))
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText(/Expiring soon/)).toBeInTheDocument())
  })

  it('cancels new stock form', async () => {
    const { user } = renderWithProviders(<InventoryPage />)
    const addBtn = await screen.findByRole('button', { name: '+ New' })

    await user.click(addBtn)
    expect(screen.getByPlaceholderText('Item name (e.g. Water filters)')).toBeInTheDocument()

    await user.click(screen.getByText('Cancel'))
    expect(screen.queryByPlaceholderText('Item name (e.g. Water filters)')).not.toBeInTheDocument()
  })

  it('cancels add lot form', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([{ ...stockItem, lots: [] }])))
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('+ Add batch')).toBeInTheDocument())

    await user.click(screen.getByText('+ Add batch'))
    expect(screen.getByPlaceholderText('0')).toBeInTheDocument()

    await user.click(screen.getByText('Cancel'))
    expect(screen.queryByPlaceholderText('0')).not.toBeInTheDocument()
  })

  it('submits lot with expiry date', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([{ ...stockItem, lots: [] }])))
    const { user, container } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('+ Add batch')).toBeInTheDocument())

    await user.click(screen.getByText('+ Add batch'))
    await user.type(screen.getByPlaceholderText('0'), '3')

    const dateInput = container.querySelector('input[type="date"]')
    await user.type(dateInput, '2027-12-31')

    await user.click(screen.getByText('Add batch'))
    await waitFor(() => expect(screen.queryByPlaceholderText('0')).not.toBeInTheDocument())
  })

  it('submits lot with lot number', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([{ ...stockItem, lots: [] }])))
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('+ Add batch')).toBeInTheDocument())

    await user.click(screen.getByText('+ Add batch'))
    await user.type(screen.getByPlaceholderText('0'), '10')

    // Fill lot number
    const lotInput = screen.getByPlaceholderText('Batch ID (optional)')
    await user.type(lotInput, 'LOT-XYZ')

    await user.click(screen.getByText('Add batch'))
    await waitFor(() => expect(screen.queryByPlaceholderText('0')).not.toBeInTheDocument())
  })

  it('renders formatted expiry dates on lots', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([stockItem])))
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('LOT-A')).toBeInTheDocument())
    // The lot with expiry_date '2025-06-01' should be formatted
    expect(screen.getByText(/Jun/)).toBeInTheDocument()
  })

  it('shows expiring warning icon on lot rows', async () => {
    const expiringStock = {
      ...stockItem,
      has_expiring_lots: true,
      expiring_lots: [{ id: 100, quantity: 5, expiry_date: '2025-06-01' }],
    }
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([expiringStock])))
    const { container } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('LOT-A')).toBeInTheDocument())
    // The lot expiry should have the danger class
    const dangerExpiry = container.querySelector('.lotExpiryDanger')
    expect(dangerExpiry).toBeInTheDocument()
  })

  it('renders page title', async () => {
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Inventory')).toBeInTheDocument())
  })

  it('disables the new-stock button offline', async () => {
    reachableRef.current = false
    try {
      renderWithProviders(<InventoryPage />)
      await waitFor(() => expect(screen.getByText('Inventory')).toBeInTheDocument())
      const btn = screen.getByRole('button', { name: /New/i })
      expect(btn).toBeDisabled()
      expect(btn).toHaveAttribute('title', 'Requires connection')
    } finally {
      reachableRef.current = true
    }
  })
})

describe('InventoryPage — consume button', () => {
  it('shows −1 button when stock has quantity > 0', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([stockItem])))
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByTitle('Consume 1 unit')).toBeInTheDocument())
  })

  it('ignores consume click while already consuming', async () => {
    server.use(
      http.get(`${BASE}/stock/`, () => HttpResponse.json([stockItem])),
      http.post(`${BASE}/stock/:id/consume/`, async () => {
        await new Promise((r) => setTimeout(r, 100))
        return HttpResponse.json({ ...stockItem, quantity: 9 })
      }),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByTitle('Consume 1 unit')).toBeInTheDocument())

    // Click twice rapidly — second click should be ignored
    const btn = screen.getByTitle('Consume 1 unit')
    await user.click(btn)
    await user.click(btn)

    // Only one consume should have gone through
    await waitFor(() => expect(screen.getByText('(9 total)')).toBeInTheDocument())
    expect(screen.queryByText('(8 total)')).not.toBeInTheDocument()
  })

  it('does not show −1 button when stock quantity is 0', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([emptyStock])))
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Water filters')).toBeInTheDocument())
    expect(screen.queryByTitle('Consume 1 unit')).not.toBeInTheDocument()
  })

  it('clicking −1 calls consume endpoint and updates quantity', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([stockItem])))
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByTitle('Consume 1 unit')).toBeInTheDocument())

    await user.click(screen.getByTitle('Consume 1 unit'))

    await waitFor(() => expect(screen.getByText('(4 total)')).toBeInTheDocument())
  })

  it('shows error when consume fails', async () => {
    server.use(
      http.get(`${BASE}/stock/`, () => HttpResponse.json([stockItem])),
      http.post(`${BASE}/stock/${stockItem.id}/consume/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByTitle('Consume 1 unit')).toBeInTheDocument())

    await user.click(screen.getByTitle('Consume 1 unit'))

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('opens lot selection modal when requires_lot_selection is true', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([stockWithLots])))
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByTitle('Consume 1 unit')).toBeInTheDocument())

    await user.click(screen.getByTitle('Consume 1 unit'))

    await waitFor(() => expect(screen.getByText('Select items to consume')).toBeInTheDocument())
  })

  it('cancelling lot modal closes it without consuming', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([stockWithLots])))
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByTitle('Consume 1 unit')).toBeInTheDocument())

    await user.click(screen.getByTitle('Consume 1 unit'))
    await waitFor(() => expect(screen.getByText('Select items to consume')).toBeInTheDocument())

    await user.click(screen.getByText('Cancel'))
    expect(screen.queryByText('Select items to consume')).not.toBeInTheDocument()
    // Quantity unchanged
    expect(screen.getByText('(10 total)')).toBeInTheDocument()
  })

  it('confirming lot selection calls consume with lot_selections and updates quantity', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([stockWithLots])))
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByTitle('Consume 1 unit')).toBeInTheDocument())

    await user.click(screen.getByTitle('Consume 1 unit'))
    await waitFor(() => expect(screen.getByText('Select items to consume')).toBeInTheDocument())

    // Select the first unit
    const items = screen.getAllByRole('radio')
    await user.click(items[0])
    await user.click(screen.getByText('Confirm'))

    await waitFor(() => expect(screen.queryByText('Select items to consume')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('(4 total)')).toBeInTheDocument())
  })
})

describe('InventoryPage — stock groups', () => {
  const groups = [
    { id: 1, name: 'Diabetes', display_order: 0, created_at: '2026-01-01T00:00:00Z' },
    { id: 2, name: 'Household', display_order: 1, created_at: '2026-01-01T00:00:00Z' },
  ]

  const groupedStock1 = { ...stockItem, id: 1, name: 'Insulin', group: 1, group_name: 'Diabetes' }
  const groupedStock2 = { ...stockItem, id: 2, name: 'Bleach', group: 2, group_name: 'Household' }
  const ungroupedStock = { ...stockItem, id: 3, name: 'Loose item', group: null, group_name: null }

  function useGroupedMocks(stockList = [groupedStock1, groupedStock2, ungroupedStock]) {
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groups })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json(stockList)),
    )
  }

  it('renders stocks grouped by group name', async () => {
    useGroupedMocks()
    const { container } = renderWithProviders(<InventoryPage />)

    await waitFor(() => expect(screen.getByText('Insulin')).toBeInTheDocument())
    expect(screen.getByText('Bleach')).toBeInTheDocument()
    // Group headers should exist
    const groupNames = container.querySelectorAll('.groupName')
    const headerTexts = [...groupNames].map((el) => el.textContent)
    expect(headerTexts).toContain('Diabetes')
    expect(headerTexts).toContain('Household')
  })

  it('renders ungrouped stocks as flat cards outside any group box', async () => {
    useGroupedMocks()
    const { container } = renderWithProviders(<InventoryPage />)

    await waitFor(() => expect(screen.getByText('Loose item')).toBeInTheDocument())
    // Ungrouped stock should NOT be inside a group-box
    const looseCard = screen.getByText('Loose item').closest('[data-testid="product-card"]')
    expect(looseCard.closest('[data-testid="group-box"]')).toBeNull()
    // But grouped stocks should be inside group boxes
    const insulinCard = screen.getByText('Insulin').closest('[data-testid="product-card"]')
    expect(insulinCard.closest('[data-testid="group-box"]')).not.toBeNull()
  })

  it('no "Ungrouped" group header when stocks are ungrouped', async () => {
    useGroupedMocks()
    const { container } = renderWithProviders(<InventoryPage />)

    await waitFor(() => expect(screen.getByText('Loose item')).toBeInTheDocument())
    const groupNames = container.querySelectorAll('.groupName')
    const headerTexts = [...groupNames].map((el) => el.textContent)
    expect(headerTexts).not.toContain('Ungrouped')
  })

  it('collapse and expand group sections', async () => {
    useGroupedMocks()
    const { user, container } = renderWithProviders(<InventoryPage />)

    await waitFor(() => expect(screen.getByText('Insulin')).toBeInTheDocument())

    // Click the Diabetes group header to collapse — find the header button containing the group name
    const diabetesHeader = [...container.querySelectorAll('.groupName')].find((el) => el.textContent === 'Diabetes')
    await user.click(diabetesHeader.closest('button'))
    expect(screen.queryByText('Insulin')).not.toBeInTheDocument()

    // Click again to expand
    await user.click(diabetesHeader.closest('button'))
    expect(screen.getByText('Insulin')).toBeInTheDocument()
  })

  it('creates a group via the group manager modal', async () => {
    let postCalled = false
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: [] })),
      http.post(`${BASE}/stock-groups/`, async ({ request }) => {
        postCalled = true
        const body = await request.json()
        return HttpResponse.json(
          { id: 99, name: body.name, display_order: 0, created_at: '2026-01-01T00:00:00Z' },
          { status: 201 },
        )
      }),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Categories')).toBeInTheDocument())

    await user.click(screen.getByText('Categories'))
    await waitFor(() => expect(screen.getByPlaceholderText('Category name')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('Category name'), 'New Group')
    await user.click(screen.getByText('Create'))

    await waitFor(() => expect(postCalled).toBe(true))
  })

  it('deletes a group via the group manager modal', async () => {
    let deleteCalled = false
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groups })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([])),
      http.delete(`${BASE}/stock-groups/:id/`, () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Categories')).toBeInTheDocument())

    await user.click(screen.getByText('Categories'))
    await waitFor(() => expect(screen.getByText('Diabetes')).toBeInTheDocument())

    // Click the delete button for Diabetes group — it's inside the modal
    const dialog = screen.getByRole('dialog')
    const deleteButtons = within(dialog).getAllByTitle('Delete category')
    await user.click(deleteButtons[0])

    // Confirm the deletion
    await waitFor(() => expect(screen.getByText(/Delete category "Diabetes"/)).toBeInTheDocument())
    const confirmDialog = screen.getAllByRole('dialog')[1]
    await user.click(within(confirmDialog).getByText('Delete category'))

    await waitFor(() => expect(deleteCalled).toBe(true))
  })

  it('assigns a group to a stock via the group picker modal', async () => {
    let patchBody = null
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groups })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([ungroupedStock])),
      http.patch(`${BASE}/stock/:id/`, async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({ ...ungroupedStock, group: 1, group_name: 'Diabetes' })
      }),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Loose item')).toBeInTheDocument())

    await user.click(screen.getByTitle('Category'))
    const modal = screen.getByRole('dialog')
    await user.click(within(modal).getByText('Diabetes'))

    await waitFor(() => expect(patchBody).not.toBeNull())
    expect(patchBody.group).toBe(1)
  })

  it('renames a group via inline edit', async () => {
    let patchBody = null
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groups })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([])),
      http.patch(`${BASE}/stock-groups/:id/`, async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({ ...groups[0], name: patchBody.name })
      }),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Categories')).toBeInTheDocument())

    await user.click(screen.getByText('Categories'))
    await waitFor(() => expect(screen.getByText('Diabetes')).toBeInTheDocument())

    // Click group name to enter edit mode
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByText('Diabetes'))

    // Type new name and press Enter
    const input = screen.getByDisplayValue('Diabetes')
    await user.clear(input)
    await user.type(input, 'Renamed{Enter}')

    await waitFor(() => expect(patchBody).not.toBeNull())
    expect(patchBody.name).toBe('Renamed')
  })

  it('cancels group rename on Escape', async () => {
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groups })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([])),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Categories')).toBeInTheDocument())

    await user.click(screen.getByText('Categories'))
    await waitFor(() => expect(screen.getByText('Diabetes')).toBeInTheDocument())

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByText('Diabetes'))

    const input = screen.getByDisplayValue('Diabetes')
    await user.keyboard('{Escape}')

    // Should exit edit mode — no input visible
    expect(screen.queryByDisplayValue('Diabetes')).not.toBeInTheDocument()
  })

  it('shows error when rename group fails', async () => {
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groups })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([])),
      http.patch(`${BASE}/stock-groups/:id/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Categories')).toBeInTheDocument())

    await user.click(screen.getByText('Categories'))
    await waitFor(() => expect(screen.getByText('Diabetes')).toBeInTheDocument())

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByText('Diabetes'))

    const input = screen.getByDisplayValue('Diabetes')
    await user.clear(input)
    await user.type(input, 'Fail{Enter}')

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('shows error when delete group fails', async () => {
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groups })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([])),
      http.delete(`${BASE}/stock-groups/:id/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Categories')).toBeInTheDocument())

    await user.click(screen.getByText('Categories'))
    await waitFor(() => expect(screen.getByText('Diabetes')).toBeInTheDocument())

    const dialog = screen.getByRole('dialog')
    const deleteButtons = within(dialog).getAllByTitle('Delete category')
    await user.click(deleteButtons[0])

    await waitFor(() => expect(screen.getByText(/Delete category "Diabetes"/)).toBeInTheDocument())
    const confirmDialog = screen.getAllByRole('dialog')[1]
    await user.click(within(confirmDialog).getByText('Delete category'))

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('moves a group down', async () => {
    const patchCalls = []
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groups })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([])),
      http.patch(`${BASE}/stock-groups/:id/`, async ({ request, params }) => {
        const body = await request.json()
        patchCalls.push({ id: Number(params.id), ...body })
        return HttpResponse.json({
          id: Number(params.id),
          name: 'Group',
          display_order: body.display_order,
          created_at: '2026-01-01T00:00:00Z',
        })
      }),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Categories')).toBeInTheDocument())

    await user.click(screen.getByText('Categories'))
    await waitFor(() => expect(screen.getByText('Diabetes')).toBeInTheDocument())

    // Click move down on first group
    const dialog = screen.getByRole('dialog')
    const moveDownBtns = within(dialog).getAllByTitle('Move down')
    await user.click(moveDownBtns[0])

    await waitFor(() => expect(patchCalls.length).toBe(2))
  })

  it('expiring soon alert remains above groups', async () => {
    const expiringStock = {
      ...groupedStock1,
      has_expiring_lots: true,
      expiring_lots: [{ id: 100, quantity: 5, expiry_date: '2025-06-01' }],
    }
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groups })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([expiringStock])),
    )
    const { container } = renderWithProviders(<InventoryPage />)

    await waitFor(() => expect(screen.getByText(/Expiring soon/)).toBeInTheDocument())

    // Alert should appear before the first group box in the DOM
    const alertBox = screen.getByTestId('alert-box')
    const groupBoxes = container.querySelectorAll('[data-testid="group-box"]')
    expect(alertBox).toBeInTheDocument()
    expect(groupBoxes.length).toBeGreaterThan(0)
    // Alert should come before the first group box in document order
    expect(alertBox.compareDocumentPosition(groupBoxes[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // ── Sharing ────────────────────────────────────────────────────────────────

  it('shows share button on stock cards when contacts exist', async () => {
    const sharingStock = {
      ...stockItem,
      shared_with: [],
      shared_with_details: [],
      is_owner: true,
      owner_username: 'testuser',
    }
    server.use(
      http.get(`${BASE}/stock/`, () => HttpResponse.json([sharingStock])),
      http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json([{ id: 10, username: 'alice' }])),
    )
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Water filters')).toBeInTheDocument())
    expect(screen.getByTitle('Share with')).toBeInTheDocument()
  })

  it('toggles share on a stock via the share modal', async () => {
    let patchBody = null
    const sharingStock = {
      ...stockItem,
      shared_with: [],
      shared_with_details: [],
      is_owner: true,
      owner_username: 'testuser',
    }
    server.use(
      http.get(`${BASE}/stock/`, () => HttpResponse.json([sharingStock])),
      http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json([{ id: 10, username: 'alice' }])),
      http.patch(`${BASE}/stock/:id/`, async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({ ...sharingStock, shared_with: [10] })
      }),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Water filters')).toBeInTheDocument())

    await user.click(screen.getByTitle('Share with'))
    const modal = screen.getByRole('dialog')
    await user.click(within(modal).getByText('alice'))

    await waitFor(() => expect(patchBody).not.toBeNull())
    expect(patchBody.shared_with).toEqual([10])
  })

  it('moves a group up', async () => {
    const patchCalls = []
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groups })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([])),
      http.patch(`${BASE}/stock-groups/:id/`, async ({ request, params }) => {
        const body = await request.json()
        patchCalls.push({ id: Number(params.id), ...body })
        return HttpResponse.json({
          id: Number(params.id),
          name: 'Group',
          display_order: body.display_order,
          created_at: '2026-01-01T00:00:00Z',
        })
      }),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Categories')).toBeInTheDocument())

    await user.click(screen.getByText('Categories'))
    await waitFor(() => expect(screen.getByText('Household')).toBeInTheDocument())

    // Click move up on the second group (Household)
    const dialog = screen.getByRole('dialog')
    const moveUpBtns = within(dialog).getAllByTitle('Move up')
    await user.click(moveUpBtns[1])

    await waitFor(() => expect(patchCalls.length).toBe(2))
  })

  it('shows error when share toggle fails', async () => {
    const sharingStock2 = {
      ...stockItem,
      shared_with: [],
      shared_with_details: [],
      is_owner: true,
      owner_username: 'testuser',
    }
    server.use(
      http.get(`${BASE}/stock/`, () => HttpResponse.json([sharingStock2])),
      http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json([{ id: 10, username: 'alice' }])),
      http.patch(`${BASE}/stock/:id/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Water filters')).toBeInTheDocument())

    await user.click(screen.getByTitle('Share with'))
    const modal = screen.getByRole('dialog')
    await user.click(within(modal).getByText('alice'))

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('shows error when assign group fails', async () => {
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groups })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([ungroupedStock])),
      http.patch(`${BASE}/stock/:id/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Loose item')).toBeInTheDocument())

    await user.click(screen.getByTitle('Category'))
    const modal = screen.getByRole('dialog')
    await user.click(within(modal).getByText('Diabetes'))

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('shows error when add lot fails', async () => {
    server.use(
      http.get(`${BASE}/stock/`, () => HttpResponse.json([{ ...stockItem, lots: [] }])),
      http.post(`${BASE}/stock/1/lots/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('+ Add batch')).toBeInTheDocument())

    await user.click(screen.getByText('+ Add batch'))
    await user.type(screen.getByPlaceholderText('0'), '5')
    await user.click(screen.getByText('Add batch'))

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('shows error when remove lot fails', async () => {
    server.use(
      http.get(`${BASE}/stock/`, () => HttpResponse.json([stockItem])),
      http.delete(`${BASE}/stock/1/lots/:lotId/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('LOT-A')).toBeInTheDocument())

    const lotDeleteBtns = screen.getAllByTitle('Delete')
    await user.click(lotDeleteBtns[1])
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByText('Delete'))

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  // Stock-level delete moved to StockDetailPage in T048.
  it.skip('shows error when remove stock fails', () => {})

  it('shows error when create group fails', async () => {
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: [] })),
      http.post(`${BASE}/stock-groups/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Categories')).toBeInTheDocument())

    await user.click(screen.getByText('Categories'))
    await waitFor(() => expect(screen.getByPlaceholderText('Category name')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('Category name'), 'Fail Group')
    await user.click(screen.getByText('Create'))

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('does not submit empty stock name', async () => {
    const { user } = renderWithProviders(<InventoryPage />)
    const addBtn = await screen.findByRole('button', { name: '+ New' })

    await user.click(addBtn)
    // Leave name empty and click create — form should remain open
    await user.click(screen.getByText('Create item'))
    expect(screen.getByPlaceholderText('Item name (e.g. Water filters)')).toBeInTheDocument()
  })

  it('does not rename group with empty name', async () => {
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groups })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([])),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Categories')).toBeInTheDocument())

    await user.click(screen.getByText('Categories'))
    await waitFor(() => expect(screen.getByText('Diabetes')).toBeInTheDocument())

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByText('Diabetes'))

    const input = screen.getByDisplayValue('Diabetes')
    await user.clear(input)
    await user.type(input, '{Enter}')

    // Should exit edit mode without error
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument()
  })

  it('un-assigns group from a stock (set to no group)', async () => {
    let patchBody = null
    const groupedItem = { ...stockItem, group: 1, group_name: 'Diabetes' }
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groups })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([groupedItem])),
      http.patch(`${BASE}/stock/:id/`, async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({ ...groupedItem, group: null, group_name: null })
      }),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Water filters')).toBeInTheDocument())

    await user.click(screen.getByTitle('Category'))
    const modal = screen.getByRole('dialog')
    await user.click(within(modal).getByText('None'))

    await waitFor(() => expect(patchBody).not.toBeNull())
    expect(patchBody.group).toBeNull()
  })

  it('shows error when the stock has no lots available for selection', async () => {
    // T063: lots-for-selection is derived from the cached stock. A stock
    // flagged `requires_lot_selection: true` but with an empty `lots`
    // array means there's nothing to pick — surface an error instead of
    // opening an empty modal.
    const emptyLotsStock = { ...stockWithLots, lots: [] }
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([emptyLotsStock])))
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByTitle('Consume 1 unit')).toBeInTheDocument())

    await user.click(screen.getByTitle('Consume 1 unit'))

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('shows warning card style when quantity is low (1-3)', async () => {
    const lowStock = { ...stockItem, quantity: 2 }
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([lowStock])))
    const { container } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Water filters')).toBeInTheDocument())
    // Shared POC border class from T046/T047 migration
    const card = container.querySelector('.cardBorderWarning')
    expect(card).toBeInTheDocument()
  })

  it('queues the consume mutation offline when the POST hits a network error', async () => {
    await clear()
    server.use(
      http.get(`${BASE}/stock/`, () => HttpResponse.json([stockItem])),
      mockNetworkError('post', `/stock/${stockItem.id}/consume/`),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByTitle('Consume 1 unit')).toBeInTheDocument())
    await user.click(screen.getByTitle('Consume 1 unit'))
    await waitFor(async () => expect(await list()).toHaveLength(1))
    await clear()
  })

  it('shows error toast when move group fails with a server error', async () => {
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groups })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([])),
      http.patch(`${BASE}/stock-groups/:id/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Categories')).toBeInTheDocument())
    await user.click(screen.getByText('Categories'))
    await waitFor(() => expect(screen.getByText('Diabetes')).toBeInTheDocument())
    const dialog = screen.getByRole('dialog')
    const moveDownBtns = within(dialog).getAllByTitle('Move down')
    await user.click(moveDownBtns[0])
    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('surfaces "action not available offline" when moving a group with no connection', async () => {
    // Stock groups became online-only in T060 (settings territory). A
    // network failure now shows the "Action not available offline" toast
    // instead of queueing the mutation.
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groups })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([])),
      http.patch(`${BASE}/stock-groups/:id/`, () => HttpResponse.error()),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Categories')).toBeInTheDocument())

    await user.click(screen.getByText('Categories'))
    await waitFor(() => expect(screen.getByText('Diabetes')).toBeInTheDocument())

    const dialog = screen.getByRole('dialog')
    const moveDownBtns = within(dialog).getAllByTitle('Move down')
    await user.click(moveDownBtns[0])

    await waitFor(() => expect(screen.getByText(/Action not available offline/i)).toBeInTheDocument())
  })

  it('moves groups with same display_order using index-based values', async () => {
    const sameOrderGroups = [
      { id: 1, name: 'Alpha', display_order: 0, created_at: '2026-01-01T00:00:00Z' },
      { id: 2, name: 'Beta', display_order: 0, created_at: '2026-01-01T00:00:00Z' },
    ]
    const patchCalls = []
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: sameOrderGroups })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([])),
      http.patch(`${BASE}/stock-groups/:id/`, async ({ request, params }) => {
        const body = await request.json()
        patchCalls.push({ id: Number(params.id), ...body })
        return HttpResponse.json({
          id: Number(params.id),
          name: 'Group',
          display_order: body.display_order,
          created_at: '2026-01-01T00:00:00Z',
        })
      }),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Categories')).toBeInTheDocument())

    await user.click(screen.getByText('Categories'))
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument())

    const dialog = screen.getByRole('dialog')
    const moveDownBtns = within(dialog).getAllByTitle('Move down')
    await user.click(moveDownBtns[0])

    await waitFor(() => expect(patchCalls.length).toBe(2))
  })

  it('closes group manager modal by clicking overlay', async () => {
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groups })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([])),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Categories')).toBeInTheDocument())

    await user.click(screen.getByText('Categories'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    // Click the overlay to close
    await user.click(screen.getByRole('dialog'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes group picker modal on Escape', async () => {
    server.use(
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groups })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([ungroupedStock])),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Loose item')).toBeInTheDocument())

    await user.click(screen.getByTitle('Category'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows owner label on shared stock where user is not owner', async () => {
    const sharedStock = {
      ...stockItem,
      shared_with: [1],
      shared_with_details: [{ id: 1, username: 'testuser' }],
      is_owner: false,
      owner_username: 'alice',
    }
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([sharedStock])))
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Water filters')).toBeInTheDocument())
    expect(screen.getByText('alice')).toBeInTheDocument()
  })
})

describe('InventoryPage — group manager soft block', () => {
  const groupsFixture = [
    { id: 1, name: 'Diabetes', display_order: 0, created_at: '2026-01-01T00:00:00Z' },
    { id: 2, name: 'Household', display_order: 1, created_at: '2026-01-01T00:00:00Z' },
  ]

  afterEach(() => {
    reachableRef.current = true
  })

  it('shows the settings-block banner inside the group manager when offline', async () => {
    reachableRef.current = false
    server.use(
      http.get(`${BASE}/stock/`, () => HttpResponse.json([])),
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groupsFixture })),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Categories')).toBeInTheDocument())
    await user.click(screen.getByText('Categories'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Settings require a connection/i)).toBeInTheDocument()
  })

  it('disables rename / move / delete / create inside the group manager when offline', async () => {
    reachableRef.current = false
    server.use(
      http.get(`${BASE}/stock/`, () => HttpResponse.json([])),
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: groupsFixture })),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Categories')).toBeInTheDocument())
    await user.click(screen.getByText('Categories'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: /Diabetes/i })).toBeDisabled()
    for (const btn of within(dialog).getAllByTitle(/Requires connection/i)) {
      expect(btn).toBeDisabled()
    }
    expect(within(dialog).getByPlaceholderText(/Group name|name/i)).toBeDisabled()
  })
})

describe('InventoryPage — depletion estimation', () => {
  it('shows depletion date when estimated_depletion_date is set', async () => {
    const depletingStock = {
      ...stockItem,
      estimated_depletion_date: '2026-05-06',
      daily_consumption_own: 2.0,
      is_low_stock: true,
    }
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([depletingStock])))
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByTestId('depletion-date')).toBeInTheDocument())
  })

  it('does not show depletion date when estimated_depletion_date is null', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([stockItem])))
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Water filters')).toBeInTheDocument())
    expect(screen.queryByTestId('depletion-date')).not.toBeInTheDocument()
  })

  it('shows own consumption only when no shared consumption', async () => {
    const ownOnly = {
      ...stockItem,
      estimated_depletion_date: '2026-07-01',
      daily_consumption_own: 1.0,
      daily_consumption_shared: null,
      is_low_stock: false,
    }
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([ownOnly])))
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByTestId('consumption-row')).toBeInTheDocument())
    expect(screen.getByText('1/day')).toBeInTheDocument()
    expect(screen.queryByText(/shared/)).not.toBeInTheDocument()
  })

  it('formats fractional daily consumption with one decimal', async () => {
    const fractionalStock = {
      ...stockItem,
      estimated_depletion_date: '2026-07-01',
      daily_consumption_own: 1.5,
      daily_consumption_shared: null,
      is_low_stock: false,
    }
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([fractionalStock])))
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByTestId('consumption-row')).toBeInTheDocument())
    expect(screen.getByText('1.5/day')).toBeInTheDocument()
  })

  it('ignores add-lot submission with an invalid quantity', async () => {
    const postSpy = vi.fn()
    server.use(
      http.get(`${BASE}/stock/`, () => HttpResponse.json([{ ...stockItem, lots: [] }])),
      http.post(`${BASE}/stock/1/lots/`, () => {
        postSpy()
        return new HttpResponse(null, { status: 201 })
      }),
    )
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('+ Add batch')).toBeInTheDocument())

    await user.click(screen.getByText('+ Add batch'))
    const qtyInput = screen.getByPlaceholderText('0')
    // Force an invalid value by setting it directly; `min={0}` is advisory in jsdom.
    await user.type(qtyInput, '-')
    // Submit: submitAddLot parses NaN/negative and returns without calling the API.
    await user.click(screen.getByText('Add batch'))
    // Form still open and no POST fired.
    expect(screen.getByPlaceholderText('0')).toBeInTheDocument()
    expect(postSpy).not.toHaveBeenCalled()
  })

  it('shows own + shared consumption breakdown', async () => {
    const mixedConsumption = {
      ...stockItem,
      estimated_depletion_date: '2026-05-06',
      daily_consumption_own: 2.0,
      daily_consumption_shared: 2.0,
      is_low_stock: true,
    }
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([mixedConsumption])))
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByTestId('consumption-row')).toBeInTheDocument())
    expect(screen.getByText('2/day')).toBeInTheDocument()
    expect(screen.getByText('2/day (shared)')).toBeInTheDocument()
  })

  it('does not show consumption row when no consumption', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([stockItem])))
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Water filters')).toBeInTheDocument())
    expect(screen.queryByTestId('consumption-row')).not.toBeInTheDocument()
  })

  it('shows low stock alert when is_low_stock is true', async () => {
    // Fractional rate exercises the formatRate ".toFixed(1)" branch for alerts.
    const lowStock = {
      ...stockItem,
      estimated_depletion_date: '2026-05-06',
      daily_consumption_own: 4.5,
      is_low_stock: true,
    }
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([lowStock])))
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText(/Low stock/)).toBeInTheDocument())
    expect(screen.getByTestId('low-stock-alert')).toBeInTheDocument()
  })

  it('does not show low stock alert when is_low_stock is false', async () => {
    const noAlert = {
      ...stockItem,
      estimated_depletion_date: '2027-01-01',
      daily_consumption_own: 0.5,
      is_low_stock: false,
    }
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([noAlert])))
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Water filters')).toBeInTheDocument())
    expect(screen.queryByTestId('low-stock-alert')).not.toBeInTheDocument()
  })

  it('shows both expiring and low stock alerts in unified section', async () => {
    const bothAlerts = {
      ...stockItem,
      has_expiring_lots: true,
      expiring_lots: [{ id: 100, quantity: 5, expiry_date: '2025-06-01' }],
      estimated_depletion_date: '2026-05-06',
      daily_consumption_own: 4.0,
      is_low_stock: true,
    }
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([bothAlerts])))
    renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByTestId('alert-box')).toBeInTheDocument())
    expect(screen.getByText(/Expiring soon/)).toBeInTheDocument()
    expect(screen.getByText(/Low stock/)).toBeInTheDocument()
  })
})
