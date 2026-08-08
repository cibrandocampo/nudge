import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import StockLotsList from '../StockLotsList'

// Fixed "today" so expiry severity never depends on when the suite runs.
const today = new Date('2026-06-01')

const lot = (overrides) => ({
  id: 1,
  quantity: 2,
  expiry_date: null,
  lot_number: '',
  serial_number: '',
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-01T10:00:00Z',
  ...overrides,
})

function renderList(overrides = {}) {
  const props = {
    lots: [lot({ id: 10, quantity: 3, lot_number: 'LOT-A' })],
    today,
    reachable: true,
    onRemoveLot: vi.fn(),
    ...overrides,
  }
  const utils = renderWithProviders(<StockLotsList {...props} />)
  return { ...utils, props }
}

describe('StockLotsList', () => {
  it('renders nothing when the stock has no lots', () => {
    // Not `toBeEmptyDOMElement`: the shared providers always render the toast
    // region into the same container, so the assertion is about this component.
    const { container } = renderList({ lots: [] })
    expect(screen.queryByTestId('lot-row')).not.toBeInTheDocument()
    expect(container.querySelector('[data-with-pills]')).toBeNull()
  })

  it('renders one row per group with its quantity, expiry and lot pill', () => {
    renderList({
      lots: [lot({ id: 10, quantity: 3, lot_number: 'LOT-A', expiry_date: '2026-09-30' })],
    })

    const rows = screen.getAllByTestId('lot-row')
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText('3 u.')).toBeInTheDocument()
    expect(within(rows[0]).getByText('LOT-A')).toBeInTheDocument()
  })

  it('gives a single-row group its own delete button, which reports that lot', async () => {
    const user = userEvent.setup()
    const onRemoveLot = vi.fn()
    const only = lot({ id: 42, quantity: 1, lot_number: 'LOT-A' })
    renderList({ lots: [only], onRemoveLot })

    expect(screen.queryByTestId('group-expander')).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('Delete'))

    expect(onRemoveLot).toHaveBeenCalledTimes(1)
    expect(onRemoveLot).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }))
  })

  it('collapses several boxes of one batch into a group row carrying the count', () => {
    renderList({
      lots: [
        lot({ id: 10, quantity: 1, lot_number: 'LOT-A', expiry_date: '2026-09-30', serial_number: 'SN-1' }),
        lot({ id: 11, quantity: 1, lot_number: 'LOT-A', expiry_date: '2026-09-30', serial_number: 'SN-2' }),
      ],
    })

    const rows = screen.getAllByTestId('lot-row')
    expect(rows).toHaveLength(1)
    // The group sums the boxes and the expander replaces the delete button.
    expect(within(rows[0]).getByText('2 u.')).toBeInTheDocument()
    const expander = within(rows[0]).getByTestId('group-expander')
    expect(within(expander).getByText('2')).toBeInTheDocument()
    expect(screen.queryByTestId('pack-row')).not.toBeInTheDocument()
  })

  it('reveals one pack row per box, each by its serial, when the group is expanded', async () => {
    const user = userEvent.setup()
    renderList({
      lots: [
        lot({ id: 10, quantity: 1, lot_number: 'LOT-A', expiry_date: '2026-09-30', serial_number: 'SN-1' }),
        lot({ id: 11, quantity: 1, lot_number: 'LOT-A', expiry_date: '2026-09-30', serial_number: 'SN-2' }),
      ],
    })

    await user.click(screen.getByTestId('group-expander'))

    const packs = screen.getAllByTestId('pack-row')
    expect(packs).toHaveLength(2)
    expect(within(packs[0]).getByText('SN-1')).toBeInTheDocument()
    expect(within(packs[1]).getByText('SN-2')).toBeInTheDocument()
  })

  it('labels an unserialized box inside a group as unidentified units', async () => {
    const user = userEvent.setup()
    renderList({
      lots: [
        lot({ id: 10, quantity: 1, lot_number: 'LOT-A', expiry_date: '2026-09-30', serial_number: 'SN-1' }),
        lot({ id: 11, quantity: 4, lot_number: 'LOT-A', expiry_date: '2026-09-30' }),
      ],
    })

    await user.click(screen.getByTestId('group-expander'))

    const packs = screen.getAllByTestId('pack-row')
    expect(within(packs[1]).getByText('Unidentified units')).toBeInTheDocument()
  })

  it('collapses the group again on a second click', async () => {
    const user = userEvent.setup()
    renderList({
      lots: [
        lot({ id: 10, quantity: 1, lot_number: 'LOT-A', serial_number: 'SN-1' }),
        lot({ id: 11, quantity: 1, lot_number: 'LOT-A', serial_number: 'SN-2' }),
      ],
    })

    const expander = screen.getByTestId('group-expander')
    await user.click(expander)
    expect(screen.getAllByTestId('pack-row')).toHaveLength(2)

    await user.click(expander)
    expect(screen.queryByTestId('pack-row')).not.toBeInTheDocument()
  })

  it('reports the individual box when deleting from an expanded pack row', async () => {
    const user = userEvent.setup()
    const onRemoveLot = vi.fn()
    renderList({
      lots: [
        lot({ id: 10, quantity: 1, lot_number: 'LOT-A', serial_number: 'SN-1' }),
        lot({ id: 11, quantity: 1, lot_number: 'LOT-A', serial_number: 'SN-2' }),
      ],
      onRemoveLot,
    })

    await user.click(screen.getByTestId('group-expander'))
    const packs = screen.getAllByTestId('pack-row')
    await user.click(within(packs[1]).getByLabelText('Delete'))

    expect(onRemoveLot).toHaveBeenCalledTimes(1)
    expect(onRemoveLot).toHaveBeenCalledWith(expect.objectContaining({ id: 11, serial_number: 'SN-2' }))
  })

  it('orders groups FEFO, earliest expiry first and no expiry last', () => {
    renderList({
      lots: [
        lot({ id: 10, quantity: 1, lot_number: 'NO-EXPIRY' }),
        lot({ id: 11, quantity: 1, lot_number: 'LATE', expiry_date: '2026-12-31' }),
        lot({ id: 12, quantity: 1, lot_number: 'EARLY', expiry_date: '2026-07-01' }),
      ],
    })

    const rows = screen.getAllByTestId('lot-row')
    expect(within(rows[0]).getByText('EARLY')).toBeInTheDocument()
    expect(within(rows[1]).getByText('LATE')).toBeInTheDocument()
    expect(within(rows[2]).getByText('NO-EXPIRY')).toBeInTheDocument()
  })

  it('marks a lot whose expiry has passed as reached', () => {
    renderList({ lots: [lot({ id: 10, quantity: 1, lot_number: 'OLD', expiry_date: '2026-05-01' })] })

    expect(screen.getByTestId('lot-row')).toHaveAttribute('data-expiring', 'reached')
  })

  it('shows an empty lot the server still reports, instead of hiding it', () => {
    // `minQuantity: 0`: the detail list renders exactly what the server sent.
    renderList({ lots: [lot({ id: 10, quantity: 0, lot_number: 'EMPTY' })] })

    expect(screen.getByTestId('lot-row')).toBeInTheDocument()
    expect(screen.getByText('EMPTY')).toBeInTheDocument()
  })

  it('disables deleting while the server is unreachable', () => {
    renderList({ reachable: false })

    const del = screen.getByLabelText('Delete')
    expect(del).toHaveAttribute('aria-disabled', 'true')
    expect(del).toHaveAttribute('title', 'This section is not available offline.')
  })

  it('switches the list to pill layout only when some lot carries a lot number', () => {
    const { container: withPills } = renderList()
    expect(withPills.querySelector('[data-with-pills]')).not.toBeNull()

    const { container: withoutPills } = renderList({ lots: [lot({ id: 10, quantity: 2 })] })
    expect(withoutPills.querySelector('[data-with-pills]')).toBeNull()
  })
})
