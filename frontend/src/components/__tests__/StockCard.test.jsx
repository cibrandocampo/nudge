import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import StockCard from '../StockCard'

const baseStock = {
  id: 1,
  name: 'Water filter',
  quantity: 5,
  group: null,
  has_expiring_lots: false,
  expiring_lots: [],
  estimated_depletion_date: null,
  daily_consumption_own: null,
  daily_consumption_shared: null,
  is_low_stock: false,
  lots: [{ id: 10, quantity: 5, expiry_date: null, lot_number: 'LOT-A', updated_at: '2026-04-17T10:00:00Z' }],
  shared_with: [],
  shared_with_details: [],
  is_owner: true,
  owner_username: 'testuser',
  updated_at: '2026-04-17T10:00:00Z',
}

function renderCard(overrides = {}) {
  const props = {
    stock: baseStock,
    consuming: false,
    flashing: false,
    onConsume: vi.fn(),
    ...overrides,
  }
  return renderWithProviders(<StockCard {...props} />)
}

describe('StockCard', () => {
  it('renders name and quantity', () => {
    renderCard()
    expect(screen.getByText('Water filter')).toBeInTheDocument()
    expect(screen.getByText('(5 total)')).toBeInTheDocument()
  })

  it('shows the depletion date when provided', () => {
    renderCard({ stock: { ...baseStock, estimated_depletion_date: '2026-06-01' } })
    expect(screen.getByTestId('depletion-date')).toBeInTheDocument()
  })

  it('hides the consume button when quantity is 0', () => {
    renderCard({ stock: { ...baseStock, quantity: 0 } })
    expect(screen.queryByLabelText('Consume 1 unit')).not.toBeInTheDocument()
  })

  it('calls onConsume when the consume button is clicked', async () => {
    const onConsume = vi.fn()
    const { user } = renderCard({ onConsume })
    await user.click(screen.getByLabelText('Consume 1 unit'))
    expect(onConsume).toHaveBeenCalledWith(baseStock)
  })

  it('exposes a shared badge (no onClick) when the owner shares with someone', () => {
    renderCard({ stock: { ...baseStock, shared_with: [2, 3] } })
    const badge = screen.getByTestId('shared-badge')
    expect(badge).toBeInTheDocument()
    // Informational only: it is a <span>, not a <button>.
    expect(badge.tagName).toBe('SPAN')
  })

  it('does not render the shared badge when the user is not the owner', () => {
    renderCard({
      stock: { ...baseStock, is_owner: false, shared_with: [], owner_username: 'alice' },
    })
    expect(screen.queryByTestId('shared-badge')).not.toBeInTheDocument()
    expect(screen.getByText('alice')).toBeInTheDocument()
  })

  it('renders the chevron with the "Open details" aria-label', () => {
    renderCard()
    expect(screen.getByLabelText('Open details')).toBeInTheDocument()
  })

  it('does not expose add-lot, delete-lot, assign-group or share-toggle controls on the card', () => {
    renderCard({ stock: { ...baseStock, shared_with: [2] } })
    // The refactor moved all of these to StockDetailPage (lots) and
    // StockFormPage (group + share). They MUST NOT appear on the list card.
    expect(screen.queryByRole('button', { name: /add batch/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^category$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /share with/i })).not.toBeInTheDocument()
  })

  it('navigates to the stock detail when the card itself is clicked', async () => {
    const { user } = renderWithProviders(
      <Routes>
        <Route
          path="/"
          element={<StockCard stock={baseStock} consuming={false} flashing={false} onConsume={vi.fn()} />}
        />
        <Route path="/inventory/:id" element={<div>Stock detail</div>} />
      </Routes>,
      { initialEntries: ['/'] },
    )
    await user.click(screen.getByText('Water filter'))
    expect(await screen.findByText('Stock detail')).toBeInTheDocument()
  })
})
