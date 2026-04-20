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
  requires_lot_selection: false,
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

const defaultAddLotForm = { show: false, qty: '', expiry: '', lotNumber: '', adding: false }

function noop() {}

function renderCard(overrides = {}) {
  const props = {
    stock: baseStock,
    consuming: false,
    flashing: false,
    canShare: false,
    onConsume: vi.fn(),
    onAssignGroup: vi.fn(),
    onToggleShare: vi.fn(),
    addLotForm: defaultAddLotForm,
    onLotFieldChange: noop,
    onToggleAddLot: noop,
    onSubmitAddLot: noop,
    onDeleteLot: vi.fn(),
    ...overrides,
  }
  return renderWithProviders(<StockCard {...props} />)
}

describe('StockCard', () => {
  it('renders name, total quantity, and lot number', () => {
    renderCard()
    expect(screen.getByText('Water filter')).toBeInTheDocument()
    expect(screen.getByText(/5 total/)).toBeInTheDocument()
    expect(screen.getByText('LOT-A')).toBeInTheDocument()
  })

  it('shows the depletion date when provided', () => {
    renderCard({ stock: { ...baseStock, estimated_depletion_date: '2026-06-15' } })
    expect(screen.getByTestId('depletion-date')).toBeInTheDocument()
  })

  it('hides the consume button when quantity is 0', () => {
    renderCard({ stock: { ...baseStock, quantity: 0, lots: [] } })
    expect(screen.queryByLabelText('Consume 1 unit')).not.toBeInTheDocument()
  })

  it('calls onConsume when the consume button is clicked', async () => {
    const onConsume = vi.fn()
    const { user } = renderCard({ onConsume })
    await user.click(screen.getByLabelText('Consume 1 unit'))
    expect(onConsume).toHaveBeenCalledWith(baseStock)
  })

  it('calls onAssignGroup with the stock id when the category button is clicked', async () => {
    const onAssignGroup = vi.fn()
    const { user } = renderCard({ onAssignGroup })
    await user.click(screen.getByLabelText('Category'))
    expect(onAssignGroup).toHaveBeenCalledWith(1)
  })

  it('renders the share button only when canShare is true and the user is owner', async () => {
    renderCard({ canShare: false })
    expect(screen.queryByLabelText('Share with')).not.toBeInTheDocument()

    const { user } = renderCard({ canShare: true })
    const shareBtn = screen.getByLabelText('Share with')
    await user.click(shareBtn)
  })

  it('renders the chevron with the "Open details" aria-label', () => {
    renderCard()
    expect(screen.getByLabelText('Open details')).toBeInTheDocument()
  })

  it('calls onDeleteLot with stockId, lotId, and updatedAt when the trash icon is clicked', async () => {
    const onDeleteLot = vi.fn()
    const { user } = renderCard({ onDeleteLot })
    await user.click(screen.getByLabelText('Delete'))
    expect(onDeleteLot).toHaveBeenCalledWith(1, 10, '2026-04-17T10:00:00Z')
  })

  it('navigates to the stock detail when the card itself is clicked', async () => {
    const { user } = renderWithProviders(
      <Routes>
        <Route
          path="/"
          element={
            <StockCard
              stock={baseStock}
              consuming={false}
              flashing={false}
              canShare={false}
              onConsume={vi.fn()}
              onAssignGroup={vi.fn()}
              onToggleShare={vi.fn()}
              addLotForm={defaultAddLotForm}
              onLotFieldChange={noop}
              onToggleAddLot={noop}
              onSubmitAddLot={noop}
              onDeleteLot={vi.fn()}
            />
          }
        />
        <Route path="/inventory/:id" element={<div>Stock detail</div>} />
      </Routes>,
      { initialEntries: ['/'] },
    )
    await user.click(screen.getByText('Water filter'))
    expect(await screen.findByText('Stock detail')).toBeInTheDocument()
  })
})
