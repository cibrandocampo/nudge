import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import StockCard from '../StockCard'

const baseStock = {
  id: 1,
  name: 'Water filter',
  quantity: 5,
  group: null,
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

  it('hides the consume button when quantity_available is 0', () => {
    renderCard({
      stock: { ...baseStock, quantity: 0, quantity_available: 0, stock_severity: 'critical' },
    })
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

  it('applies cardBorderDanger when stock_severity is "critical"', () => {
    const { container } = renderCard({
      stock: { ...baseStock, quantity: 0, quantity_available: 0, stock_severity: 'critical' },
    })
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

  it('shows the out-of-stock literal in the footer when quantity_available=0 with consumption', () => {
    renderCard({
      stock: {
        ...baseStock,
        quantity: 0,
        quantity_available: 0,
        stock_severity: 'critical',
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

describe('StockCard — combined severity and per-lot indicators', () => {
  // Frozen UTC midnight so lot dates are deterministic regardless of CI tz.
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date('2026-05-06T00:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // Dates relative to the frozen "today" = 2026-05-06.
  const PAST = '2026-05-05' // 1 day ago → reached
  const SOON = '2026-05-21' // 15 days ahead → soon
  const FAR = '2026-07-05' // 60 days ahead → none

  const multiLotStock = {
    ...baseStock,
    lots: [
      { id: 10, quantity: 1, expiry_date: PAST, lot_number: 'PAST', updated_at: '2026-04-17T10:00:00Z' },
      { id: 11, quantity: 1, expiry_date: SOON, lot_number: 'SOON', updated_at: '2026-04-17T10:00:00Z' },
      { id: 12, quantity: 1, expiry_date: FAR, lot_number: 'FAR', updated_at: '2026-04-17T10:00:00Z' },
      { id: 13, quantity: 1, expiry_date: null, lot_number: 'NO_EXP', updated_at: '2026-04-17T10:00:00Z' },
    ],
  }

  // T166: header rendering — quantity_available + (N expired) suffix.

  it('header shows quantity_available, not the total, when there are expired lots', () => {
    const { container } = renderCard({
      stock: {
        ...baseStock,
        quantity: 18,
        quantity_available: 13,
        quantity_expired: 5,
      },
    })
    const qty = container.querySelector('[class*="stockQty"]:not([class*="stockQtyExpired"])')
    expect(qty.textContent).toMatch(/13/)
    expect(qty.textContent).not.toMatch(/18/)
    const expired = container.querySelector('[class*="stockQtyExpired"]')
    expect(expired).not.toBeNull()
    expect(expired.textContent).toMatch(/5 expired/)
  })

  it('header omits the expired suffix when quantity_expired is 0', () => {
    const { container } = renderCard({
      stock: { ...baseStock, quantity: 5, quantity_available: 5, quantity_expired: 0 },
    })
    expect(container.querySelector('[class*="stockQtyExpired"]')).toBeNull()
  })

  it('header falls back to quantity when quantity_available is missing (cold cache)', () => {
    // Simulates a snapshot persisted before T163 — only the legacy `quantity`
    // is present. The fallback chain renders the value without crashing.
    const { container } = renderCard({
      stock: { ...baseStock, quantity: 7 },
    })
    const qty = container.querySelector('[class*="stockQty"]:not([class*="stockQtyExpired"])')
    expect(qty.textContent).toMatch(/7/)
  })

  it('hides the consume button when quantity_available is 0 even with expired lots in the stock', () => {
    renderCard({
      stock: {
        ...baseStock,
        quantity: 5,
        quantity_available: 0,
        quantity_expired: 5,
        stock_severity: 'critical',
      },
    })
    expect(screen.queryByLabelText('Consume 1 unit')).not.toBeInTheDocument()
  })

  // Per-lot indicators on a stock with mixed lot expiries. Each row carries
  // its own data-expiring; the package <Icon> is tinted via iconClassForLot.
  it('marks the past-expiry lot row as data-expiring="reached" and tints icon iconDanger', () => {
    renderCard({ stock: multiLotStock })
    const rows = screen.getAllByTestId('card-lot-row')
    const reachedRow = rows.find((r) => r.getAttribute('data-expiring') === 'reached')
    expect(reachedRow).toBeDefined()
    const icon = reachedRow.querySelector('svg use[href="#i-package"]').parentElement
    expect(icon.getAttribute('class') ?? '').toContain('iconDanger')
  })

  it('marks the 15-day-out lot row as data-expiring="soon" and tints icon iconWarning', () => {
    renderCard({ stock: multiLotStock })
    const rows = screen.getAllByTestId('card-lot-row')
    const soonRow = rows.find((r) => r.getAttribute('data-expiring') === 'soon')
    expect(soonRow).toBeDefined()
    const icon = soonRow.querySelector('svg use[href="#i-package"]').parentElement
    expect(icon.getAttribute('class') ?? '').toContain('iconWarning')
  })

  it('leaves the far-future lot row as data-expiring="none" and the icon untinted', () => {
    renderCard({ stock: multiLotStock })
    const rows = screen.getAllByTestId('card-lot-row')
    const farRow = rows.find((r) => r.textContent.includes('FAR'))
    expect(farRow).toBeDefined()
    expect(farRow.getAttribute('data-expiring')).toBe('none')
    const icon = farRow.querySelector('svg use[href="#i-package"]').parentElement
    const cls = icon.getAttribute('class') ?? ''
    expect(cls).not.toContain('iconDanger')
    expect(cls).not.toContain('iconWarning')
  })

  it('marks a lot without expiry_date as data-expiring="none"', () => {
    renderCard({ stock: multiLotStock })
    const rows = screen.getAllByTestId('card-lot-row')
    const noExpRow = rows.find((r) => r.textContent.includes('NO_EXP'))
    expect(noExpRow).toBeDefined()
    expect(noExpRow.getAttribute('data-expiring')).toBe('none')
  })

  // T166: per-lot expiry date tint + line-through on expired qty.

  it('tints the lot expiry date span on a soon-expiring lot', () => {
    renderCard({ stock: multiLotStock })
    const rows = screen.getAllByTestId('card-lot-row')
    const soonRow = rows.find((r) => r.getAttribute('data-expiring') === 'soon')
    expect(soonRow).toBeDefined()
    const dateSpan = soonRow.querySelector('[class*="cardLotExpiry"]')
    expect(dateSpan).not.toBeNull()
    expect(dateSpan.getAttribute('class')).toContain('iconWarning')
  })

  it('applies line-through to the qty span of an expired (reached) lot', () => {
    renderCard({ stock: multiLotStock })
    const rows = screen.getAllByTestId('card-lot-row')
    const reachedRow = rows.find((r) => r.getAttribute('data-expiring') === 'reached')
    expect(reachedRow).toBeDefined()
    const qtySpan = reachedRow.querySelector('[class*="cardLotQty"]')
    expect(qtySpan).not.toBeNull()
    expect(qtySpan.getAttribute('class')).toContain('cardLotQtyExpired')
  })
})
