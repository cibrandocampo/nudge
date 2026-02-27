import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import InventoryPage from '../InventoryPage'

const BASE = 'http://localhost/api'

const stockItem = {
  id: 1,
  name: 'Water filters',
  quantity: 10,
  has_expiring_lots: false,
  expiring_lots: [],
  lots: [
    { id: 100, quantity: 5, expiry_date: '2025-06-01', lot_number: 'LOT-A' },
    { id: 101, quantity: 5, expiry_date: null, lot_number: '' },
  ],
}

describe('InventoryPage', () => {
  it('shows loading state initially', () => {
    renderWithProviders(<InventoryPage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
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
    await waitFor(() => expect(screen.getByText('+ New')).toBeInTheDocument())

    await user.click(screen.getByText('+ New'))
    const input = screen.getByPlaceholderText('Item name (e.g. Water filters)')
    await user.type(input, 'Bad Item')
    await user.click(screen.getByText('Create item'))

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('shows + New button and creates stock', async () => {
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('+ New')).toBeInTheDocument())

    await user.click(screen.getByText('+ New'))
    const input = screen.getByPlaceholderText('Item name (e.g. Water filters)')
    await user.type(input, 'New Item')
    await user.click(screen.getByText('Create item'))

    await waitFor(() => expect(screen.getByText('New Item')).toBeInTheDocument())
  })

  it('confirms and deletes a stock item', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([stockItem])))
    const { user } = renderWithProviders(<InventoryPage />)
    await waitFor(() => expect(screen.getByText('Water filters')).toBeInTheDocument())

    // Click the stock delete button (✕) — first one with title "Delete"
    const deleteBtns = screen.getAllByTitle('Delete')
    await user.click(deleteBtns[0])
    expect(screen.getByText(/Delete "Water filters"/)).toBeInTheDocument()

    // Confirm delete
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByText('Delete'))

    await waitFor(() => expect(screen.queryByText('Water filters')).not.toBeInTheDocument())
  })

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

    // Find the delete lot button (🗑)
    const lotDeleteBtns = screen.getAllByTitle('Delete')
    // First is the stock delete (✕), rest are lot deletes (🗑)
    await user.click(lotDeleteBtns[1])
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
    await waitFor(() => expect(screen.getByText('+ New')).toBeInTheDocument())

    await user.click(screen.getByText('+ New'))
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
})
