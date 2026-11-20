import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import { lotsForSelection } from '../../utils/lotsForSelection'
import LotConsumeModal from '../LotConsumeModal'

// The modal consumes exactly what `lotsForSelection` produces, so fixtures are
// built by running the real grouping over raw lots. A hand-written group object
// could drift from its producer; this cannot.
// A fixed today keeps the fixtures' expiries valid however long the suite lives.
const TODAY = new Date('2026-01-01')
const groupsFrom = (lots) => lotsForSelection({ lots }, TODAY)

const mockGroups = groupsFrom([
  { id: 1, lot_number: 'LOT-A', expiry_date: '2027-01-01', quantity: 5 },
  { id: 2, lot_number: '', expiry_date: null, quantity: 3 },
])

describe('LotConsumeModal', () => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // 1. Title and subtitle (single mode)
  it('renders title and subtitle for single mode', () => {
    renderWithProviders(<LotConsumeModal needed={1} groups={mockGroups} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByText('Select items to consume')).toBeInTheDocument()
    expect(screen.getByText('Select which lot to consume from')).toBeInTheDocument()
  })

  // 2. Lot rows with lot_number, quantity, and expiry
  it('renders lot rows with lot_number, quantity, and expiry', () => {
    renderWithProviders(<LotConsumeModal needed={1} groups={mockGroups} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByText('LOT-A')).toBeInTheDocument()
    expect(screen.getByText('No ID')).toBeInTheDocument()
    expect(screen.getByText('2027-01-01')).toBeInTheDocument()
    expect(screen.getByText(/5 available/)).toBeInTheDocument()
    expect(screen.getByText(/3 available/)).toBeInTheDocument()
  })

  // 3. Single mode — radio selection works
  it('single mode: selecting a lot and confirming sends correct data', async () => {
    const { user } = renderWithProviders(
      <LotConsumeModal needed={1} groups={mockGroups} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('LOT-A'))
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 1, quantity: 1 }])
  })

  // 4. Single mode — changing selection replaces previous
  it('single mode: selecting another lot replaces previous selection', async () => {
    const { user } = renderWithProviders(
      <LotConsumeModal needed={1} groups={mockGroups} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('LOT-A'))
    await user.click(screen.getByText('No ID'))
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 2, quantity: 1 }])
  })

  // 5. Single mode — first lot is pre-selected
  it('single mode: first lot is pre-selected and confirm works immediately', async () => {
    const { user } = renderWithProviders(
      <LotConsumeModal needed={1} groups={mockGroups} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    const firstItem = screen.getByText('LOT-A').closest('[role="radio"]')
    expect(firstItem).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 1, quantity: 1 }])
  })

  // 6. Multi mode — renders stepper controls
  it('multi mode: renders stepper buttons', () => {
    renderWithProviders(<LotConsumeModal needed={4} groups={mockGroups} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByText(/Distribute 4 units across lots/)).toBeInTheDocument()
    expect(screen.getAllByLabelText('Increase')).toHaveLength(2)
    expect(screen.getAllByLabelText('Decrease')).toHaveLength(2)
  })

  // 7. Multi mode — pre-distributed total counter
  it('multi mode: pre-distributes quantities and shows correct total', () => {
    renderWithProviders(<LotConsumeModal needed={4} groups={mockGroups} onConfirm={onConfirm} onCancel={onCancel} />)
    // needed=4, group A has 5 → takes 4, group B gets 0 → total 4/4
    expect(screen.getByText(/4\/4/)).toBeInTheDocument()
  })

  // 8. Multi mode — confirm sends pre-distributed data
  it('multi mode: confirm sends pre-distributed FEFO data', async () => {
    const { user } = renderWithProviders(
      <LotConsumeModal needed={4} groups={mockGroups} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 1, quantity: 4 }])
  })

  // 9. Multi mode — confirm disabled after adjusting total away from needed
  it('multi mode: confirm disabled when total does not match needed', async () => {
    const { user } = renderWithProviders(
      <LotConsumeModal needed={4} groups={mockGroups} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    const decButtons = screen.getAllByLabelText('Decrease')
    await user.click(decButtons[0])
    expect(screen.getByText('Confirm')).toBeDisabled()
    fireEvent.click(screen.getByText('Confirm'))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  // 10. Multi mode — stepper clamped to [0, group.quantity]
  it('multi mode: + button disabled at lot max, - button disabled at 0', () => {
    const groups = groupsFrom([{ id: 1, lot_number: 'LOT-A', expiry_date: null, quantity: 2 }])
    renderWithProviders(<LotConsumeModal needed={2} groups={groups} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByLabelText('Increase')).toBeDisabled()
    expect(screen.getByLabelText('Decrease')).not.toBeDisabled()
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  // 11. Escape closes modal
  it('Escape key closes modal', () => {
    renderWithProviders(<LotConsumeModal needed={1} groups={mockGroups} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  // 12. Click overlay closes modal
  it('clicking overlay closes modal', () => {
    renderWithProviders(<LotConsumeModal needed={1} groups={mockGroups} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('dialog').parentElement)
    expect(onCancel).toHaveBeenCalled()
  })

  // 13. Cancel button closes modal
  it('Cancel button closes modal', async () => {
    const { user } = renderWithProviders(
      <LotConsumeModal needed={1} groups={mockGroups} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
  })

  // 14. Multi mode — FEFO pre-distribution spans multiple groups
  it('multi mode: pre-distributes across multiple lots in FEFO order', () => {
    const groups = groupsFrom([
      { id: 1, lot_number: 'SOON', expiry_date: '2027-01-01', quantity: 2 },
      { id: 2, lot_number: 'LATER', expiry_date: '2027-06-01', quantity: 5 },
    ])
    renderWithProviders(<LotConsumeModal needed={4} groups={groups} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByText(/4\/4/)).toBeInTheDocument()
  })

  // 15. Multi mode — redistribute with steppers sends only non-zero entries
  it('multi mode: adjusting steppers and confirming sends only non-zero entries', async () => {
    const groups = groupsFrom([
      { id: 1, lot_number: 'LOT-A', expiry_date: null, quantity: 3 },
      { id: 2, lot_number: 'LOT-B', expiry_date: null, quantity: 3 },
    ])
    const { user } = renderWithProviders(
      <LotConsumeModal needed={2} groups={groups} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getAllByLabelText('Decrease')[0]) // LOT-A: 2→1
    await user.click(screen.getAllByLabelText('Increase')[1]) // LOT-B: 0→1
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith([
      { lot_id: 1, quantity: 1 },
      { lot_id: 2, quantity: 1 },
    ])
  })

  // 16. Single mode — error when no lots and confirming (null selection path)
  it('single mode: shows error when confirming with empty lots', async () => {
    const { user } = renderWithProviders(
      <LotConsumeModal needed={1} groups={[]} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  // 17. Multi mode — total below needed keeps confirm disabled
  it('multi mode: shows error text when confirming with wrong total', () => {
    const groups = groupsFrom([{ id: 1, lot_number: 'LOT-A', expiry_date: null, quantity: 1 }])
    renderWithProviders(<LotConsumeModal needed={3} groups={groups} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByText('1/3')).toBeInTheDocument()
    expect(screen.getByText('Confirm')).toBeDisabled()
  })

  // 18. Single mode — Enter key on radio item selects it
  it('single mode: Enter key on item selects it', async () => {
    const { user } = renderWithProviders(
      <LotConsumeModal needed={1} groups={mockGroups} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    const item = screen.getByText('LOT-A').closest('li')
    item.focus()
    await user.keyboard('{Enter}')
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 1, quantity: 1 }])
  })
})

// The user is asked the lot, never the box: a unit carries its lot number and
// expiry, not the serial of the box it came from (T125). Inside the chosen lot
// the units come out in consumption order — the opened box first.
describe('LotConsumeModal — one step, the lot', () => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Two boxes of one batch: a full one scanned first, an opened one after.
  const twoBoxes = groupsFrom([
    { id: 11, lot_number: 'LOT-A', expiry_date: '2028-06-01', quantity: 10, serial_number: 'SN-1', created_at: '1' },
    { id: 12, lot_number: 'LOT-A', expiry_date: '2028-06-01', quantity: 4, serial_number: 'SN-2', created_at: '2' },
  ])

  it('shows two boxes of the same lot as one row, without their serials', () => {
    renderWithProviders(<LotConsumeModal needed={1} groups={twoBoxes} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getAllByTestId('lot-group-row')).toHaveLength(1)
    expect(screen.getByText(/14 available/)).toBeInTheDocument()
    expect(screen.queryByText('SN-1')).not.toBeInTheDocument()
    expect(screen.queryByText('SN-2')).not.toBeInTheDocument()
  })

  it('confirms in one step, sending the opened box', async () => {
    const { user } = renderWithProviders(
      <LotConsumeModal needed={1} groups={twoBoxes} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 12, quantity: 1 }])
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })

  it('finishes the opened box before taking from the full one', async () => {
    const { user } = renderWithProviders(
      <LotConsumeModal needed={6} groups={twoBoxes} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith([
      { lot_id: 12, quantity: 4 },
      { lot_id: 11, quantity: 2 },
    ])
  })

  it('does not offer an expired lot', () => {
    const groups = groupsFrom([
      { id: 61, lot_number: 'GONE', expiry_date: '2025-12-31', quantity: 3 },
      { id: 62, lot_number: 'GOOD', expiry_date: '2028-01-01', quantity: 3 },
    ])
    renderWithProviders(<LotConsumeModal needed={1} groups={groups} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getAllByTestId('lot-group-row')).toHaveLength(1)
    expect(screen.queryByText('GONE')).not.toBeInTheDocument()
    expect(screen.getByText('GOOD')).toBeInTheDocument()
  })
})
