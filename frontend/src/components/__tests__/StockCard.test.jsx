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
  expiring_lots: [],
  estimated_depletion_date: null,
  daily_consumption_own: null,
  daily_consumption_shared: null,
  stock_severity: 'ok',
  expiry_severity: 'ok',
  lots: [{ id: 10, quantity: 3, expiry_date: null, lot_number: 'LOT-A', updated_at: '2026-04-17T10:00:00Z' }],
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
    expect(screen.getByText('5 u.')).toBeInTheDocument()
  })

  it('shows the depletion date when provided and there is consumption', () => {
    renderCard({
      stock: {
        ...baseStock,
        estimated_depletion_date: '2026-06-01',
        daily_consumption_own: 1,
      },
    })
    expect(screen.getByTestId('depletion-date')).toBeInTheDocument()
  })

  it('renders the equal-approximately icon when depletion is estimated from past usage', () => {
    renderCard({
      stock: {
        ...baseStock,
        estimated_depletion_date: '2027-01-01',
        daily_consumption_own: 0.05,
        depletion_is_estimated: true,
      },
    })
    // The icon sits at the start of the consumption row — the whole line
    // (rate + depletion) is the estimated block, not just the date. The
    // parent row carries the `title` so hover and screen readers surface
    // the rationale; the SVG itself stays aria-hidden per icon convention.
    const row = screen.getByTestId('consumption-row')
    expect(row.querySelector('svg use[href="#i-equal-approximately"]')).not.toBeNull()
    expect(row.getAttribute('title')).toBe('Estimated from past usage')
    // The depletion-date span must NOT carry the marker any more.
    const span = screen.getByTestId('depletion-date')
    expect(span.querySelector('svg use[href="#i-equal-approximately"]')).toBeNull()
  })

  it('omits the equal-approximately icon when depletion is not estimated', () => {
    renderCard({
      stock: {
        ...baseStock,
        estimated_depletion_date: '2027-01-01',
        daily_consumption_own: 1.0,
        depletion_is_estimated: false,
      },
    })
    const row = screen.getByTestId('consumption-row')
    expect(row.querySelector('svg use[href="#i-equal-approximately"]')).toBeNull()
    expect(row.getAttribute('title')).toBeNull()
  })

  it('hides the consume button when quantity is 0', () => {
    renderCard({ stock: { ...baseStock, quantity: 0, stock_severity: 'out' } })
    expect(screen.queryByLabelText('Consume 1 unit')).not.toBeInTheDocument()
  })

  it('calls onConsume when the consume button is clicked', async () => {
    const onConsume = vi.fn()
    const { user } = renderCard({ onConsume })
    await user.click(screen.getByLabelText('Consume 1 unit'))
    expect(onConsume).toHaveBeenCalledWith(baseStock)
  })

  it('renders the owner-variant badge (no onClick) when the owner shares with someone', () => {
    renderCard({ stock: { ...baseStock, shared_with: [2, 3] } })
    const badge = screen.getByTestId('shared-badge')
    expect(badge).toBeInTheDocument()
    // Informational only: it is a <span>, not a <button>.
    expect(badge.tagName).toBe('SPAN')
    expect(badge.getAttribute('data-variant')).toBe('owner')
    expect(badge.className).toContain('btnIconShared')
    expect(badge.className).not.toContain('btnIconSharedRecipient')
  })

  it('renders the recipient-variant badge when the user is not the owner', () => {
    renderCard({
      stock: { ...baseStock, is_owner: false, shared_with: [], owner_username: 'alice' },
    })
    const badge = screen.getByTestId('shared-badge')
    expect(badge).toBeInTheDocument()
    expect(badge.getAttribute('data-variant')).toBe('recipient')
    expect(badge.className).toContain('btnIconSharedRecipient')
  })

  it('omits the badge when the owner has not shared the stock', () => {
    renderCard({ stock: { ...baseStock, shared_with: [], is_owner: true, owner_username: 'testuser' } })
    expect(screen.queryByTestId('shared-badge')).not.toBeInTheDocument()
  })

  it('never renders the inline owner-label, regardless of role', () => {
    for (const overrides of [
      { shared_with: [], is_owner: true, owner_username: 'testuser' },
      { shared_with: [2], is_owner: true, owner_username: 'testuser' },
      { shared_with: [], is_owner: false, owner_username: 'alice' },
    ]) {
      const { unmount } = renderCard({ stock: { ...baseStock, ...overrides } })
      expect(screen.queryByTestId('owner-label')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('interpolates the owner username into the recipient badge aria-label', () => {
    renderCard({
      stock: { ...baseStock, is_owner: false, shared_with: [], owner_username: 'alice' },
    })
    const badge = screen.getByTestId('shared-badge')
    expect(badge.getAttribute('aria-label')).toContain('alice')
    expect(badge.getAttribute('title')).toContain('alice')
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

  it('disables the consume button while a consume is already in flight', () => {
    renderCard({ consuming: true })
    expect(screen.getByLabelText('Consume 1 unit')).toBeDisabled()
  })

  it('applies cardBorderDanger when stock_severity is "out"', () => {
    const { container } = renderCard({ stock: { ...baseStock, quantity: 0, stock_severity: 'out' } })
    expect(container.querySelector('[data-testid="product-card"]').className).toMatch(/cardBorderDanger/)
  })

  it('applies cardBorderWarning when stock_severity is "low"', () => {
    const { container } = renderCard({ stock: { ...baseStock, quantity: 2, stock_severity: 'low' } })
    expect(container.querySelector('[data-testid="product-card"]').className).toMatch(/cardBorderWarning/)
  })

  it('applies cardBorderSuccess when stock_severity is "ok"', () => {
    const { container } = renderCard({ stock: { ...baseStock, quantity: 5, stock_severity: 'ok' } })
    expect(container.querySelector('[data-testid="product-card"]').className).toMatch(/cardBorderSuccess/)
  })

  it('paints the depletion date orange when stock_severity is "low"', () => {
    renderCard({
      stock: {
        ...baseStock,
        quantity: 10,
        stock_severity: 'low',
        estimated_depletion_date: '2026-05-15',
        daily_consumption_own: 1,
      },
    })
    const depletion = screen.getByTestId('depletion-date')
    expect(depletion.className).toMatch(/stockDepletionWarn/)
    expect(depletion.className).not.toMatch(/stockDepletionDanger/)
  })

  it('leaves the depletion date neutral when stock_severity is "ok"', () => {
    renderCard({
      stock: {
        ...baseStock,
        stock_severity: 'ok',
        estimated_depletion_date: '2027-01-01',
        daily_consumption_own: 1,
      },
    })
    const depletion = screen.getByTestId('depletion-date')
    expect(depletion.className).not.toMatch(/stockDepletionWarn/)
    expect(depletion.className).not.toMatch(/stockDepletionDanger/)
  })

  it('renders the monthly consumption row combining own and shared values', () => {
    renderCard({
      stock: { ...baseStock, daily_consumption_own: 1.5, daily_consumption_shared: 0.5 },
    })
    const row = screen.getByTestId('consumption-row')
    expect(row).toBeInTheDocument()
    expect(row.textContent).toContain('45')
    expect(row.textContent).toContain('15')
    expect(row.textContent).toContain(' + ')
  })

  it('renders an integer-formatted monthly rate (no trailing decimals)', () => {
    renderCard({
      stock: { ...baseStock, daily_consumption_own: 2, daily_consumption_shared: null },
    })
    const row = screen.getByTestId('consumption-row')
    expect(row.textContent).toMatch(/\b60\/month\b/)
  })

  it('renders one row per lot in the lots block', () => {
    renderCard({
      stock: {
        ...baseStock,
        lots: [
          { id: 10, quantity: 5, expiry_date: '2026-06-01', lot_number: 'LOT-A', updated_at: '2026-04-17T10:00:00Z' },
          { id: 11, quantity: 3, expiry_date: null, lot_number: null, updated_at: '2026-04-17T10:00:00Z' },
        ],
      },
    })
    const rows = screen.getAllByTestId('card-lot-row')
    expect(rows).toHaveLength(2)
  })

  it('hides the lots block when stock has no lots', () => {
    renderCard({ stock: { ...baseStock, lots: [] } })
    expect(screen.queryByTestId('card-lot-row')).not.toBeInTheDocument()
  })

  it('shows the out-of-stock literal in the footer when qty=0 with consumption', () => {
    renderCard({
      stock: {
        ...baseStock,
        quantity: 0,
        stock_severity: 'out',
        daily_consumption_own: 1,
        estimated_depletion_date: '2026-04-27',
      },
    })
    expect(screen.getByTestId('out-of-stock-footer')).toBeInTheDocument()
    expect(screen.queryByTestId('depletion-date')).not.toBeInTheDocument()
  })

  it('hides the consumption row entirely when there is no rate', () => {
    renderCard({
      stock: {
        ...baseStock,
        daily_consumption_own: null,
        daily_consumption_shared: null,
        estimated_depletion_date: null,
      },
    })
    expect(screen.queryByTestId('consumption-row')).not.toBeInTheDocument()
  })

  it('places the severity dot inside the title row', () => {
    const { container } = renderCard()
    const title = container.querySelector('[data-testid="product-card"] [class*="cardTitle"]')
    expect(title).not.toBeNull()
    const dot = title.querySelector('[class*="dot"]')
    expect(dot).not.toBeNull()
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
