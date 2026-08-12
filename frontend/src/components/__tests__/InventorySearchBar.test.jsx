import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/helpers'
import InventorySearchBar from '../InventorySearchBar'

const CHIPS = [
  { id: 'all', kind: 'all', name: null, count: 4 },
  { id: 'attention', kind: 'attention', name: null, count: 2 },
  { id: 'group-10', kind: 'group', name: 'Diabetes', count: 3 },
  { id: 'ungrouped', kind: 'ungrouped', name: null, count: 1 },
]

const renderBar = (props = {}) =>
  renderWithProviders(
    <InventorySearchBar
      query=""
      onQueryChange={vi.fn()}
      chips={CHIPS}
      activeChip="all"
      onChipChange={vi.fn()}
      {...props}
    />,
  )

describe('InventorySearchBar — search box', () => {
  it('renders an empty search input', () => {
    renderBar()
    expect(screen.getByTestId('stock-search')).toHaveValue('')
  })

  it('reports each keystroke to the parent', async () => {
    const onQueryChange = vi.fn()
    const user = userEvent.setup()
    renderBar({ onQueryChange })
    await user.type(screen.getByTestId('stock-search'), 'hid')
    // Controlled input with a mocked handler: the value never advances, so
    // each keystroke reports the same single character.
    expect(onQueryChange).toHaveBeenCalledTimes(3)
  })

  it('offers no clear button while the query is empty', () => {
    renderBar({ query: '' })
    expect(screen.queryByTestId('stock-search-clear')).not.toBeInTheDocument()
  })

  it('clears the query through the clear button', async () => {
    const onQueryChange = vi.fn()
    const user = userEvent.setup()
    renderBar({ query: 'hidro', onQueryChange })
    await user.click(screen.getByTestId('stock-search-clear'))
    expect(onQueryChange).toHaveBeenCalledWith('')
  })
})

describe('InventorySearchBar — chips', () => {
  it('renders one chip per descriptor, with its count', () => {
    renderBar()
    const chips = screen.getAllByTestId('stock-filter-chip')
    expect(chips.map((c) => c.getAttribute('data-chip'))).toEqual(['all', 'attention', 'group-10', 'ungrouped'])
    expect(chips.map((c) => c.textContent)).toEqual(['All4', 'Attention2', 'Diabetes3', 'No category1'])
  })

  it('labels a group chip with the group name, not a translation key', () => {
    renderBar()
    expect(screen.getByText('Diabetes')).toBeInTheDocument()
  })

  it('marks only the active chip', () => {
    renderBar({ activeChip: 'group-10' })
    const chips = screen.getAllByTestId('stock-filter-chip')
    const active = chips.filter((c) => c.getAttribute('data-active') === 'true')
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveAttribute('data-chip', 'group-10')
    expect(active[0]).toHaveAttribute('aria-pressed', 'true')
  })

  it('reports the chosen chip to the parent', async () => {
    const onChipChange = vi.fn()
    const user = userEvent.setup()
    renderBar({ onChipChange })
    await user.click(screen.getByText('Diabetes'))
    expect(onChipChange).toHaveBeenCalledWith('group-10')
  })

  it('renders exactly the chips it is given, and no others', () => {
    // Filtering out empty chips is `buildFilterChips`'s job; the bar must not
    // second-guess it, or the two would disagree about what is on screen.
    renderBar({ chips: [{ id: 'all', kind: 'all', name: null, count: 0 }] })
    expect(screen.getAllByTestId('stock-filter-chip')).toHaveLength(1)
    expect(screen.queryByText('Attention')).not.toBeInTheDocument()
  })
})
