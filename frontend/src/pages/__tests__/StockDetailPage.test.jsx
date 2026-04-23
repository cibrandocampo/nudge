import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, vi } from 'vitest'
import { clear, list } from '../../offline/queue'
import { mockNetworkError } from '../../test/mocks/handlers'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import StockDetailPage from '../StockDetailPage'

const reachableRef = { current: true }
vi.mock('../../hooks/useServerReachable', () => ({
  useServerReachable: () => reachableRef.current,
}))

const BASE = 'http://localhost/api'

const stock = {
  id: 1,
  name: 'Water filter',
  quantity: 10,
  group: null,
  has_expiring_lots: false,
  expiring_lots: [],
  estimated_depletion_date: null,
  daily_consumption_own: null,
  daily_consumption_shared: null,
  is_low_stock: false,
  is_owner: true,
  owner_username: 'testuser',
  shared_with: [],
  shared_with_details: [],
  updated_at: '2026-04-17T10:00:00Z',
  lots: [
    { id: 100, quantity: 5, expiry_date: '2027-01-01', lot_number: 'LOT-A', updated_at: '2026-04-17T10:00:00Z' },
    { id: 101, quantity: 5, expiry_date: null, lot_number: '', updated_at: '2026-04-17T10:00:00Z' },
  ],
}

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/inventory/:id" element={<StockDetailPage />} />
      <Route path="/inventory/:id/edit" element={<div>Edit form stub</div>} />
      <Route path="/inventory" element={<div>Inventory home</div>} />
    </Routes>,
    { initialEntries: ['/inventory/1'] },
  )
}

describe('StockDetailPage', () => {
  beforeEach(() => {
    reachableRef.current = true
    server.use(
      http.get(`${BASE}/stock/1/`, () => HttpResponse.json(stock)),
      http.get(`${BASE}/stock-consumptions/`, () => HttpResponse.json({ results: [] })),
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: [] })),
    )
  })

  it('shows spinner while loading', () => {
    renderDetail()
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
  })

  it('renders the stock name, quantity and lots', async () => {
    renderDetail()
    expect(await screen.findByText('Water filter')).toBeInTheDocument()
    expect(screen.getByText(/10 total/)).toBeInTheDocument()
    expect(screen.getByText('LOT-A')).toBeInTheDocument()
  })

  it('shows not-found message when the API returns 404', async () => {
    server.use(http.get(`${BASE}/stock/1/`, () => new HttpResponse(null, { status: 404 })))
    renderDetail()
    await waitFor(() => expect(screen.getByText(/Stock not found/)).toBeInTheDocument())
  })

  it('renders the stock name as static text, not as an editable input', async () => {
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    // Clicking the name must NOT turn it into an input (inline edit retired).
    await user.click(screen.getByText('Water filter'))
    expect(screen.queryByDisplayValue('Water filter')).not.toBeInTheDocument()
  })

  it('navigates to /inventory/:id/edit when the Edit button is clicked', async () => {
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('Edit form stub')).toBeInTheDocument()
  })

  it('disables the Edit button when offline', async () => {
    reachableRef.current = false
    renderDetail()
    await screen.findByText('Water filter')
    const btn = screen.getByRole('button', { name: 'Edit' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', 'Requires connection')
  })

  it('hides the Edit button when the current user is not the owner', async () => {
    server.use(
      http.get(`${BASE}/stock/1/`, () => HttpResponse.json({ ...stock, is_owner: false, owner_username: 'alice' })),
    )
    renderDetail()
    await screen.findByText('Water filter')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('ignores add-lot submission with an invalid quantity', async () => {
    const postSpy = vi.fn()
    server.use(
      http.post(`${BASE}/stock/1/lots/`, () => {
        postSpy()
        return new HttpResponse(null, { status: 201 })
      }),
    )
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    // Typing only '-' keeps qty as empty string in the number input, which
    // parseInt turns into NaN and the handler short-circuits.
    const qtyInput = screen.getByPlaceholderText('0')
    await user.type(qtyInput, '-')
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    expect(postSpy).not.toHaveBeenCalled()
  })

  it('adds a lot via the form when the inputs are valid', async () => {
    let postBody = null
    server.use(
      http.post(`${BASE}/stock/1/lots/`, async ({ request }) => {
        postBody = await request.json()
        return HttpResponse.json({ id: 200, ...postBody }, { status: 201 })
      }),
    )
    const { user, container } = renderDetail()
    await screen.findByText('Water filter')
    await user.type(screen.getByPlaceholderText('0'), '7')
    const dateInput = container.querySelector('input[type="date"]')
    await user.type(dateInput, '2027-12-31')
    await user.type(screen.getByPlaceholderText('Batch ID (optional)'), 'FILT-Z')
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    await waitFor(() => expect(postBody?.quantity).toBe(7))
    expect(postBody.lot_number).toBe('FILT-Z')
  })

  it('deletes a lot through the confirm modal', async () => {
    let deleteCalled = false
    server.use(
      http.delete(`${BASE}/stock/1/lots/100/`, () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    const lotDeleteBtns = screen.getAllByTitle('Delete')
    await user.click(lotDeleteBtns[0])
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteCalled).toBe(true))
  })

  it('deletes the stock and navigates back to /inventory', async () => {
    let deleteCalled = false
    server.use(
      http.delete(`${BASE}/stock/1/`, () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByRole('button', { name: /Delete stock/ }))
    const dialog = screen.getByRole('dialog')
    // Confirm inside the dialog
    const confirmBtn = dialog.querySelectorAll('button')[1]
    await user.click(confirmBtn)
    await waitFor(() => expect(deleteCalled).toBe(true))
    await waitFor(() => expect(screen.getByText('Inventory home')).toBeInTheDocument())
  })

  it('shows error toast when delete stock fails with a server error', async () => {
    server.use(http.delete(`${BASE}/stock/1/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByRole('button', { name: /Delete stock/ }))
    const dialog = screen.getByRole('dialog')
    const confirmBtn = dialog.querySelectorAll('button')[1]
    await user.click(confirmBtn)
    await waitFor(() => expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument())
  })

  it('queues delete stock offline when the DELETE hits a network error', async () => {
    await clear()
    server.use(mockNetworkError('delete', '/stock/1/'))
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByRole('button', { name: /Delete stock/ }))
    const dialog = screen.getByRole('dialog')
    const confirmBtn = dialog.querySelectorAll('button')[1]
    await user.click(confirmBtn)
    await waitFor(async () => expect(await list()).toHaveLength(1))
    await clear()
  })

  it('renders depletion date and low-stock markup when present', async () => {
    const lowStock = {
      ...stock,
      estimated_depletion_date: '2026-05-06',
      daily_consumption_own: 2.5,
      is_low_stock: true,
      quantity: 2,
    }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(lowStock)))
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('depletion-date')).toBeInTheDocument())
  })

  it('shows the owner username when the stock is shared with the current user', async () => {
    const sharedStock = { ...stock, is_owner: false, owner_username: 'alice' }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(sharedStock)))
    renderDetail()
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())
  })

  it('renders the danger-status dot when the quantity is 0', async () => {
    const empty = { ...stock, quantity: 0, lots: [] }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(empty)))
    const { container } = renderDetail()
    await screen.findByText('Water filter')
    expect(container.querySelector('.cardBorderDanger')).toBeInTheDocument()
  })

  it('renders the group name when the stock belongs to a group', async () => {
    const groupedStock = { ...stock, group: 1 }
    server.use(
      http.get(`${BASE}/stock/1/`, () => HttpResponse.json(groupedStock)),
      http.get(`${BASE}/stock-groups/`, () =>
        HttpResponse.json({ results: [{ id: 1, name: 'Household', display_order: 0 }] }),
      ),
    )
    renderDetail()
    await waitFor(() => expect(screen.getByText('Household')).toBeInTheDocument())
  })

  it('shows generic error state when the API fails with a non-404 status', async () => {
    server.use(http.get(`${BASE}/stock/1/`, () => new HttpResponse(null, { status: 500 })))
    renderDetail()
    await waitFor(() => expect(screen.getByText(/Could not load data/)).toBeInTheDocument())
  })

  it('shows error toast when add-lot fails with a server error', async () => {
    server.use(http.post(`${BASE}/stock/1/lots/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.type(screen.getByPlaceholderText('0'), '3')
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    await waitFor(() => expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument())
  })

  it('shows error toast when delete lot fails with a server error', async () => {
    server.use(http.delete(`${BASE}/stock/1/lots/100/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    const lotDeleteBtns = screen.getAllByTitle('Delete')
    await user.click(lotDeleteBtns[0])
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument())
  })

  it('renders recent consumption rows when the API returns entries', async () => {
    server.use(
      http.get(`${BASE}/stock-consumptions/`, () =>
        HttpResponse.json({
          results: [
            { id: 1, quantity: 2, created_at: '2026-04-15T10:00:00Z', consumed_by_username: 'alice' },
            { id: 2, quantity: 1, created_at: '2026-04-10T10:00:00Z', consumed_by_username: null },
          ],
        }),
      ),
    )
    renderDetail()
    await waitFor(() => expect(screen.getByText(/Recent consumption/)).toBeInTheDocument())
    // HistoryEntryCard renders consumed_by_username via the sharing.consumedBy
    // i18n key → "by alice".
    expect(screen.getByText('by alice')).toBeInTheDocument()
  })
})
