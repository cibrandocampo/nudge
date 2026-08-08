import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import { lotsForSelection } from '../../utils/lotsForSelection'
import LotConsumeModal from '../LotConsumeModal'

// The modal consumes exactly what `lotsForSelection` produces, so fixtures are
// built by running the real grouping over raw lots. A hand-written group object
// could drift from its producer; this cannot.
const groupsFrom = (lots) => lotsForSelection({ lots })

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

describe('LotConsumeModal — pack step', () => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const twoPacks = groupsFrom([
    { id: 11, lot_number: 'LOT-A', expiry_date: '2028-06-01', quantity: 1, serial_number: 'SN-1' },
    { id: 12, lot_number: 'LOT-A', expiry_date: '2028-06-01', quantity: 1, serial_number: 'SN-2' },
  ])

  it('groups two packs of the same batch into one row', () => {
    renderWithProviders(<LotConsumeModal needed={1} groups={twoPacks} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getAllByTestId('lot-group-row')).toHaveLength(1)
    expect(screen.getByText(/2 available/)).toBeInTheDocument()
  })

  it('asks which pack, and sends the lot_id of the chosen box', async () => {
    const { user } = renderWithProviders(
      <LotConsumeModal needed={1} groups={twoPacks} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))
    expect(screen.getByText('Which pack?')).toBeInTheDocument()
    expect(screen.getByText(/LOT-A · 2 packs/)).toBeInTheDocument()

    await user.click(screen.getByText('SN-2'))
    await user.click(screen.getByTestId('pack-confirm'))
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 12, quantity: 1 }])
  })

  it('preselects the oldest pack so confirming twice is enough', async () => {
    const { user } = renderWithProviders(
      <LotConsumeModal needed={1} groups={twoPacks} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))
    await user.click(screen.getByTestId('pack-confirm'))
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 11, quantity: 1 }])
  })

  it('skips the pack step for a lot with no serials', async () => {
    const { user } = renderWithProviders(
      <LotConsumeModal needed={1} groups={mockGroups} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))
    expect(screen.queryByText('Which pack?')).not.toBeInTheDocument()
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 1, quantity: 1 }])
  })

  it('lets the user go back to the lot list', async () => {
    const { user } = renderWithProviders(
      <LotConsumeModal needed={1} groups={twoPacks} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))
    await user.click(screen.getByText('Back'))
    expect(screen.getByText('Select items to consume')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('skips the pack step when the lot holds a single identified box', async () => {
    const onePack = groupsFrom([
      // One serial covering ten units: there is nothing to choose between.
      { id: 41, lot_number: 'LOT-1', expiry_date: '2028-06-01', quantity: 10, serial_number: 'SN-ONLY' },
    ])
    const { user } = renderWithProviders(
      <LotConsumeModal needed={1} groups={onePack} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))

    expect(screen.queryByText('Which pack?')).not.toBeInTheDocument()
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 41, quantity: 1 }])
  })

  it('takes the single box of a mixed lot without asking', async () => {
    const mixedOnePack = groupsFrom([
      { id: 51, lot_number: 'LOT-M1', expiry_date: '2028-06-01', quantity: 2, serial_number: 'SN-SOLO' },
      { id: 52, lot_number: 'LOT-M1', expiry_date: '2028-06-01', quantity: 5, serial_number: '' },
    ])
    const { user } = renderWithProviders(
      <LotConsumeModal needed={1} groups={mixedOnePack} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))

    expect(screen.queryByText('Which pack?')).not.toBeInTheDocument()
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 51, quantity: 1 }])
  })

  it('offers the unidentified units of a mixed lot as an alternative', async () => {
    const mixed = groupsFrom([
      { id: 21, lot_number: 'LOT-M', expiry_date: '2028-06-01', quantity: 1, serial_number: 'SN-9' },
      { id: 23, lot_number: 'LOT-M', expiry_date: '2028-06-01', quantity: 1, serial_number: 'SN-10' },
      { id: 22, lot_number: 'LOT-M', expiry_date: '2028-06-01', quantity: 5, serial_number: '' },
    ])
    const { user } = renderWithProviders(
      <LotConsumeModal needed={1} groups={mixed} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))
    await user.click(screen.getByTestId('bulk-row'))
    await user.click(screen.getByTestId('pack-confirm'))
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 22, quantity: 1 }])
  })

  it('sends one entry per pack when several units are consumed', async () => {
    const { user } = renderWithProviders(
      <LotConsumeModal needed={2} groups={twoPacks} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))
    expect(screen.getByText('2/2')).toBeInTheDocument()
    await user.click(screen.getByTestId('pack-confirm'))
    expect(onConfirm).toHaveBeenCalledWith([
      { lot_id: 11, quantity: 1 },
      { lot_id: 12, quantity: 1 },
    ])
  })

  it('refuses to continue when fewer packs are named than units consumed', async () => {
    const { user } = renderWithProviders(
      <LotConsumeModal needed={2} groups={twoPacks} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))
    await user.click(screen.getByText('SN-2')) // deselect → 1 of 2
    await user.click(screen.getByTestId('pack-confirm'))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText(/Select 2 pack/)).toBeInTheDocument()
  })

  it('walks one pack step per lot when two multi-pack lots are involved', async () => {
    const twoLots = groupsFrom([
      { id: 31, lot_number: 'LOT-A', expiry_date: '2028-01-01', quantity: 1, serial_number: 'SN-A1' },
      { id: 33, lot_number: 'LOT-A', expiry_date: '2028-01-01', quantity: 1, serial_number: 'SN-A2' },
      { id: 32, lot_number: 'LOT-B', expiry_date: '2028-06-01', quantity: 1, serial_number: 'SN-B1' },
      { id: 34, lot_number: 'LOT-B', expiry_date: '2028-06-01', quantity: 1, serial_number: 'SN-B2' },
    ])
    const { user } = renderWithProviders(
      <LotConsumeModal needed={3} groups={twoLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    // FEFO pre-distribution: 2 from LOT-A, 1 from LOT-B.
    await user.click(screen.getByText('Confirm'))
    expect(screen.getByText('SN-A1')).toBeInTheDocument()
    await user.click(screen.getByTestId('pack-confirm'))
    // Second lot's own pack step.
    expect(screen.getByText('SN-B1')).toBeInTheDocument()
    await user.click(screen.getByTestId('pack-confirm'))
    expect(onConfirm).toHaveBeenCalledWith([
      { lot_id: 31, quantity: 1 },
      { lot_id: 33, quantity: 1 },
      { lot_id: 32, quantity: 1 },
    ])
  })

  it('goes back from the second pack step to the first, not to the lot list', async () => {
    const twoLots = groupsFrom([
      { id: 31, lot_number: 'LOT-A', expiry_date: '2028-01-01', quantity: 1, serial_number: 'SN-A1' },
      { id: 33, lot_number: 'LOT-A', expiry_date: '2028-01-01', quantity: 1, serial_number: 'SN-A2' },
      { id: 32, lot_number: 'LOT-B', expiry_date: '2028-06-01', quantity: 1, serial_number: 'SN-B1' },
      { id: 34, lot_number: 'LOT-B', expiry_date: '2028-06-01', quantity: 1, serial_number: 'SN-B2' },
    ])
    const { user } = renderWithProviders(
      <LotConsumeModal needed={3} groups={twoLots} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))
    await user.click(screen.getByTestId('pack-confirm'))
    expect(screen.getByText('SN-B1')).toBeInTheDocument()

    await user.click(screen.getByText('Back'))
    // One step back is LOT-A's pack step. Going straight to the lot list would
    // throw away a choice the user did not ask to undo.
    expect(screen.getByText('SN-A1')).toBeInTheDocument()
    expect(screen.queryByText('SN-B1')).not.toBeInTheDocument()
  })

  it('ignores a pack picked beyond the number of units being consumed', async () => {
    const threePacks = groupsFrom([
      { id: 71, lot_number: 'LOT-T', expiry_date: '2028-01-01', quantity: 1, serial_number: 'SN-1' },
      { id: 72, lot_number: 'LOT-T', expiry_date: '2028-01-01', quantity: 1, serial_number: 'SN-2' },
      { id: 73, lot_number: 'LOT-T', expiry_date: '2028-01-01', quantity: 1, serial_number: 'SN-3' },
    ])
    const { user } = renderWithProviders(
      <LotConsumeModal needed={2} groups={threePacks} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))
    expect(screen.getByText('2/2')).toBeInTheDocument()

    // The first two are preselected; the third has nowhere to go. Deselecting
    // one first is the way to swap — silently dropping an earlier choice would
    // be the modal picking for the user.
    await user.click(screen.getByText('SN-3'))
    expect(screen.getByText('2/2')).toBeInTheDocument()
    await user.click(screen.getByTestId('pack-confirm'))
    expect(onConfirm).toHaveBeenCalledWith([
      { lot_id: 71, quantity: 1 },
      { lot_id: 72, quantity: 1 },
    ])
  })

  it('toggles a pack with Enter, and ignores other keys', async () => {
    const twoPacksLot = groupsFrom([
      { id: 81, lot_number: 'LOT-E', expiry_date: '2028-01-01', quantity: 1, serial_number: 'SN-X' },
      { id: 82, lot_number: 'LOT-E', expiry_date: '2028-01-01', quantity: 1, serial_number: 'SN-Y' },
    ])
    const { user } = renderWithProviders(
      <LotConsumeModal needed={1} groups={twoPacksLot} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))
    const [, second] = screen.getAllByTestId('pack-row')
    second.focus()
    await user.keyboard('{Enter}')
    expect(second).toHaveAttribute('aria-checked', 'true')

    await user.keyboard('a')
    expect(second).toHaveAttribute('aria-checked', 'true')
  })

  it('selects the unidentified units with Enter when one unit is consumed', async () => {
    const mixed = groupsFrom([
      { id: 91, lot_number: 'LOT-M', expiry_date: '2028-01-01', quantity: 1, serial_number: 'SN-M1' },
      { id: 92, lot_number: 'LOT-M', expiry_date: '2028-01-01', quantity: 1, serial_number: 'SN-M2' },
      { id: 93, lot_number: 'LOT-M', expiry_date: '2028-01-01', quantity: 4, serial_number: '' },
    ])
    const { user } = renderWithProviders(
      <LotConsumeModal needed={1} groups={mixed} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))
    const bulk = screen.getByTestId('bulk-row')
    bulk.focus()
    await user.keyboard('{Enter}')
    expect(bulk).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByTestId('pack-confirm'))
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 93, quantity: 1 }])
  })

  it('shows the unidentified units as read-only when several units are consumed', async () => {
    const mixed = groupsFrom([
      { id: 94, lot_number: 'LOT-N', expiry_date: '2028-01-01', quantity: 1, serial_number: 'SN-N1' },
      { id: 95, lot_number: 'LOT-N', expiry_date: '2028-01-01', quantity: 1, serial_number: 'SN-N2' },
      { id: 96, lot_number: 'LOT-N', expiry_date: '2028-01-01', quantity: 4, serial_number: '' },
    ])
    const { user } = renderWithProviders(
      <LotConsumeModal needed={2} groups={mixed} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Confirm'))
    const bulk = screen.getByTestId('bulk-row')
    // Informational: the shortfall is taken from here automatically, so there
    // is nothing to click and no checked state to report.
    expect(bulk).not.toHaveAttribute('role')
    expect(bulk).not.toHaveAttribute('aria-checked')
    expect(bulk).toHaveTextContent('4 available')
  })
})

// The pack step is skipped when a group holds one identified pack — there is
// nothing to choose. That left the user consuming a named box without ever
// being told which one, so the group row shows it instead (T042). Informing,
// not asking: no step is added.
describe('LotConsumeModal — the solo pack is named on the group row', () => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const render1 = (groups, needed = 1) =>
    renderWithProviders(<LotConsumeModal needed={needed} groups={groups} onConfirm={onConfirm} onCancel={onCancel} />)

  it('shows the serial when the group holds exactly one identified pack', () => {
    const onePack = groupsFrom([
      { id: 41, lot_number: 'LOT-1', expiry_date: '2028-06-01', quantity: 10, serial_number: 'SN-ONLY' },
    ])
    render1(onePack)
    expect(screen.getByTestId('group-serial')).toHaveTextContent('SN-ONLY')
  })

  it('shows no serial on the group row when several packs are on offer', () => {
    const twoPacksLot = groupsFrom([
      { id: 11, lot_number: 'LOT-A', expiry_date: '2028-06-01', quantity: 1, serial_number: 'SN-1' },
      { id: 12, lot_number: 'LOT-A', expiry_date: '2028-06-01', quantity: 1, serial_number: 'SN-2' },
    ])
    render1(twoPacksLot)
    // Choosing between them is what the pack step is for; naming one here
    // would claim a box the user has not picked yet.
    expect(screen.queryByTestId('group-serial')).not.toBeInTheDocument()
    expect(screen.queryByText('SN-1')).not.toBeInTheDocument()
  })

  it('leaves a group with no identified packs unchanged', () => {
    render1(mockGroups)
    expect(screen.queryByTestId('group-serial')).not.toBeInTheDocument()
  })

  it('names the solo pack of a mixed group, which is what comes out first', () => {
    const mixedOnePack = groupsFrom([
      { id: 51, lot_number: 'LOT-M1', expiry_date: '2028-06-01', quantity: 2, serial_number: 'SN-SOLO' },
      { id: 52, lot_number: 'LOT-M1', expiry_date: '2028-06-01', quantity: 5, serial_number: '' },
    ])
    render1(mixedOnePack)
    // `allocateFromGroup` takes chosen packs before bulk, so a single unit
    // consumed from this group is SN-SOLO.
    expect(screen.getByTestId('group-serial')).toHaveTextContent('SN-SOLO')
  })

  // The regression guard for the whole task: this adds information, not a
  // different allocation.
  it('confirms a single-pack group with the same lotSelections as before', async () => {
    const onePack = groupsFrom([
      { id: 41, lot_number: 'LOT-1', expiry_date: '2028-06-01', quantity: 10, serial_number: 'SN-ONLY' },
    ])
    const { user } = render1(onePack)
    await user.click(screen.getByText('Confirm'))

    expect(screen.queryByText('Which pack?')).not.toBeInTheDocument()
    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 41, quantity: 1 }])
  })
})
