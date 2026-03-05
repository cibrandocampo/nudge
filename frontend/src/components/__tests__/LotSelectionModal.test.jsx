import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import LotSelectionModal from '../LotSelectionModal'

const mockLots = [
  { lot_id: 1, lot_number: 'LOT-A', expiry_date: '2027-01-01', quantity: 5 },
  { lot_id: 2, lot_number: null, expiry_date: null, quantity: 3 },
]

const singleRoutine = { name: 'Test routine', stock_usage: 1, stock_name: 'Filters' }
const multiRoutine = { name: 'Test routine', stock_usage: 4, stock_name: 'Filters' }

describe('LotSelectionModal', () => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // 1. Title and subtitle (single mode)
  it('renders title and subtitle for single mode', () => {
    renderWithProviders(
      <LotSelectionModal routine={singleRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    expect(screen.getByText('Select items to consume')).toBeInTheDocument()
    expect(screen.getByText('Select which lot to consume from')).toBeInTheDocument()
  })

  // 2. Lot rows with lot_number, quantity, and expiry
  it('renders lot rows with lot_number, quantity, and expiry', () => {
    renderWithProviders(
      <LotSelectionModal routine={singleRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    expect(screen.getByText('LOT-A')).toBeInTheDocument()
    expect(screen.getByText('No ID')).toBeInTheDocument()
    expect(screen.getByText('2027-01-01')).toBeInTheDocument()
    expect(screen.getByText(/5 available/)).toBeInTheDocument()
    expect(screen.getByText(/3 available/)).toBeInTheDocument()
  })

  // 3. Single mode — radio selection works
  it('single mode: selecting a lot and confirming sends correct data', async () => {
    const { user } = renderWithProviders(
      <LotSelectionModal routine={singleRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('LOT-A'))
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 1, quantity: 1 }])
  })

  // 4. Single mode — changing selection replaces previous
  it('single mode: selecting another lot replaces previous selection', async () => {
    const { user } = renderWithProviders(
      <LotSelectionModal routine={singleRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('LOT-A'))
    await user.click(screen.getByText('No ID'))
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 2, quantity: 1 }])
  })

  // 5. Single mode — first lot is pre-selected
  it('single mode: first lot is pre-selected and confirm works immediately', async () => {
    const { user } = renderWithProviders(
      <LotSelectionModal routine={singleRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    const firstItem = screen.getByText('LOT-A').closest('[role="radio"]')
    expect(firstItem).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 1, quantity: 1 }])
  })

  // 6. Multi mode — renders stepper controls
  it('multi mode: renders stepper buttons', () => {
    renderWithProviders(
      <LotSelectionModal routine={multiRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    expect(screen.getByText(/Distribute 4 units across lots/)).toBeInTheDocument()
    const increaseButtons = screen.getAllByLabelText('Increase')
    expect(increaseButtons).toHaveLength(2)
    const decreaseButtons = screen.getAllByLabelText('Decrease')
    expect(decreaseButtons).toHaveLength(2)
  })

  // 7. Multi mode — pre-distributed total counter
  it('multi mode: pre-distributes quantities and shows correct total', () => {
    renderWithProviders(
      <LotSelectionModal routine={multiRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    // needed=4, lot1 has 5 → takes 4, lot2 gets 0 → total 4/4
    expect(screen.getByText(/4\/4/)).toBeInTheDocument()
  })

  // 8. Multi mode — confirm sends pre-distributed data
  it('multi mode: confirm sends pre-distributed FEFO data', async () => {
    const { user } = renderWithProviders(
      <LotSelectionModal routine={multiRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    // Pre-distributed: lot1=4, lot2=0 → confirm right away
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 1, quantity: 4 }])
  })

  // 9. Multi mode — confirm disabled after adjusting total away from needed
  it('multi mode: confirm disabled when total does not match needed', async () => {
    const { user } = renderWithProviders(
      <LotSelectionModal routine={multiRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    // Pre-distributed total=4. Decrease lot1 → total=3, confirm disabled
    const decButtons = screen.getAllByLabelText('Decrease')
    await user.click(decButtons[0])
    expect(screen.getByText('Confirm')).toBeDisabled()
    fireEvent.click(screen.getByText('Confirm'))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  // 10. Multi mode — stepper clamped to [0, lot.quantity]
  it('multi mode: + button disabled at lot max, - button disabled at 0', () => {
    const lots = [{ lot_id: 1, lot_number: 'LOT-A', expiry_date: null, quantity: 2 }]
    const routine = { name: 'Test', stock_usage: 2, stock_name: 'Filters' }
    renderWithProviders(<LotSelectionModal routine={routine} lots={lots} onConfirm={onConfirm} onCancel={onCancel} />)
    const dec = screen.getByLabelText('Decrease')
    const inc = screen.getByLabelText('Increase')
    // Pre-distributed: lot1=2 (max) → + disabled, - enabled
    expect(inc).toBeDisabled()
    expect(dec).not.toBeDisabled()
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  // 11. Escape closes modal
  it('Escape key closes modal', () => {
    renderWithProviders(
      <LotSelectionModal routine={singleRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  // 12. Click overlay closes modal
  it('clicking overlay closes modal', () => {
    renderWithProviders(
      <LotSelectionModal routine={singleRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    fireEvent.click(screen.getByRole('dialog'))
    expect(onCancel).toHaveBeenCalled()
  })

  // 13. Cancel button closes modal
  it('Cancel button closes modal', async () => {
    const { user } = renderWithProviders(
      <LotSelectionModal routine={singleRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
  })

  // 14. Multi mode — FEFO pre-distribution spans multiple lots
  it('multi mode: pre-distributes across multiple lots in FEFO order', () => {
    const lots = [
      { lot_id: 1, lot_number: 'SOON', expiry_date: '2027-01-01', quantity: 2 },
      { lot_id: 2, lot_number: 'LATER', expiry_date: '2027-06-01', quantity: 5 },
    ]
    const routine = { name: 'Test', stock_usage: 4, stock_name: 'Filters' }
    renderWithProviders(<LotSelectionModal routine={routine} lots={lots} onConfirm={onConfirm} onCancel={onCancel} />)
    // SOON gets min(2,4)=2, LATER gets min(5,2)=2 → total 4/4
    expect(screen.getByText(/4\/4/)).toBeInTheDocument()
  })

  // 15. Multi mode — redistribute with steppers sends only non-zero entries
  it('multi mode: adjusting steppers and confirming sends only non-zero entries', async () => {
    const lots = [
      { lot_id: 1, lot_number: 'LOT-A', expiry_date: null, quantity: 3 },
      { lot_id: 2, lot_number: 'LOT-B', expiry_date: null, quantity: 3 },
    ]
    const routine = { name: 'Test', stock_usage: 2, stock_name: 'Filters' }
    const { user } = renderWithProviders(
      <LotSelectionModal routine={routine} lots={lots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    // Pre-distributed: LOT-A=2, LOT-B=0. Move 1 from A to B.
    const decButtons = screen.getAllByLabelText('Decrease')
    const incButtons = screen.getAllByLabelText('Increase')
    await user.click(decButtons[0]) // LOT-A: 2→1
    await user.click(incButtons[1]) // LOT-B: 0→1
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith([
      { lot_id: 1, quantity: 1 },
      { lot_id: 2, quantity: 1 },
    ])
  })

  // 16. Single mode — Enter key on radio item selects it
  it('single mode: Enter key on item selects it', async () => {
    const { user } = renderWithProviders(
      <LotSelectionModal routine={singleRoutine} lots={mockLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    const item = screen.getByText('LOT-A').closest('li')
    item.focus()
    await user.keyboard('{Enter}')
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 1, quantity: 1 }])
  })
})
