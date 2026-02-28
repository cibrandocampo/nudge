import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import LotSelectionModal from '../LotSelectionModal'

const mockLots = [
  { lot_id: 1, lot_number: 'LOT-A', expiry_date: '2027-01-01', unit_index: 1 },
  { lot_id: 1, lot_number: 'LOT-A', expiry_date: '2027-01-01', unit_index: 2 },
  { lot_id: 2, lot_number: null, expiry_date: null, unit_index: 1 },
]

const baseRoutine = { name: 'Test routine', stock_usage: 1, stock_name: 'Filters' }

describe('LotSelectionModal', () => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders title and subtitle', () => {
    renderWithProviders(
      <LotSelectionModal routine={baseRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    expect(screen.getByText('Select items to consume')).toBeInTheDocument()
    expect(screen.getByText(/Select 1 item/i)).toBeInTheDocument()
  })

  it('renders lot labels including no-id fallback', () => {
    renderWithProviders(
      <LotSelectionModal routine={baseRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    expect(screen.getByText('LOT-A (1)')).toBeInTheDocument()
    expect(screen.getByText('LOT-A (2)')).toBeInTheDocument()
    expect(screen.getByText('No ID (1)')).toBeInTheDocument()
  })

  it('renders expiry date when present', () => {
    renderWithProviders(
      <LotSelectionModal routine={baseRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    expect(screen.getAllByText('2027-01-01').length).toBeGreaterThan(0)
  })

  it('single selection: selecting one lot calls onConfirm with correct lotSelections', async () => {
    const { user } = renderWithProviders(
      <LotSelectionModal routine={baseRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('LOT-A (1)'))
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 1, quantity: 1 }])
  })

  it('single selection: selecting another replaces previous selection', async () => {
    const { user } = renderWithProviders(
      <LotSelectionModal routine={baseRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('LOT-A (1)'))
    await user.click(screen.getByText('No ID (1)'))
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 2, quantity: 1 }])
  })

  it('shows error when confirming without enough selection', async () => {
    const { user } = renderWithProviders(
      <LotSelectionModal routine={baseRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))
    expect(screen.getByText(/Select exactly 1 item/i)).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('multi-selection: must select exactly stock_usage items', async () => {
    const routine = { ...baseRoutine, stock_usage: 2 }
    const { user } = renderWithProviders(
      <LotSelectionModal routine={routine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    // Select only one
    await user.click(screen.getByText('LOT-A (1)'))
    await user.click(screen.getByText('Confirm'))
    expect(screen.getByText(/Select exactly 2 item/i)).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('multi-selection: selecting exactly stock_usage items calls onConfirm', async () => {
    const routine = { ...baseRoutine, stock_usage: 2 }
    const { user } = renderWithProviders(
      <LotSelectionModal routine={routine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('LOT-A (1)'))
    await user.click(screen.getByText('LOT-A (2)'))
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 1, quantity: 2 }])
  })

  it('multi-selection: deselecting a unit removes it', async () => {
    const routine = { ...baseRoutine, stock_usage: 2 }
    const { user } = renderWithProviders(
      <LotSelectionModal routine={routine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    // Select two, then deselect one
    await user.click(screen.getByText('LOT-A (1)'))
    await user.click(screen.getByText('LOT-A (2)'))
    await user.click(screen.getByText('LOT-A (1)')) // deselect
    await user.click(screen.getByText('Confirm'))
    expect(screen.getByText(/Select exactly 2 item/i)).toBeInTheDocument()
  })

  it('calls onCancel when Cancel button clicked', async () => {
    const { user } = renderWithProviders(
      <LotSelectionModal routine={baseRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('calls onCancel when overlay is clicked', () => {
    renderWithProviders(
      <LotSelectionModal routine={baseRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    fireEvent.click(screen.getByRole('dialog'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('calls onCancel on Escape key', () => {
    renderWithProviders(
      <LotSelectionModal routine={baseRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('Enter key on item toggles selection', async () => {
    const { user } = renderWithProviders(
      <LotSelectionModal routine={baseRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    const item = screen.getByText('LOT-A (1)').closest('li')
    item.focus()
    await user.keyboard('{Enter}')
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 1, quantity: 1 }])
  })
})
