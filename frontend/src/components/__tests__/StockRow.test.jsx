import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '../../test/helpers'
import StockRow from '../StockRow'

const stock = (over = {}) => ({
  id: 1,
  name: 'Water filter',
  quantity: 5,
  quantity_available: 5,
  quantity_expired: 0,
  stock_severity: 'ok',
  expiry_severity: 'none',
  estimated_depletion_date: null,
  depletion_is_estimated: false,
  daily_consumption_own: 0,
  daily_consumption_shared: 0,
  shared_with: [],
  is_owner: true,
  lots: [],
  ...over,
})

const renderRow = (over = {}, props = {}) =>
  renderWithProviders(<StockRow stock={stock(over)} consuming={false} onConsume={vi.fn()} {...props} />)

describe('StockRow — line 1', () => {
  it('shows the name and the available quantity', () => {
    renderRow({ name: 'Hidroferol', quantity_available: 55 })
    expect(screen.getByText('Hidroferol')).toBeInTheDocument()
    expect(screen.getByText(/55 u\./)).toBeInTheDocument()
  })

  it('falls back to quantity, then to zero, when availability is absent', () => {
    const { unmount } = renderRow({ quantity: 7, quantity_available: undefined })
    expect(screen.getByText(/7 u\./)).toBeInTheDocument()
    unmount()

    renderRow({ quantity: undefined, quantity_available: undefined })
    expect(screen.getByText(/0 u\./)).toBeInTheDocument()
  })

  it('qualifies the quantity with the expired count when there is one', () => {
    renderRow({ quantity_expired: 3 })
    expect(screen.getByText(/3 expired/)).toBeInTheDocument()
  })

  it.each([
    ['nothing is expired', 0],
    // Absent from cold-cache snapshots written before the field existed.
    ['the field is absent', undefined],
  ])('omits the expired count when %s', (_label, quantity_expired) => {
    renderRow({ quantity_expired })
    expect(screen.queryByText(/expired/)).not.toBeInTheDocument()
  })

  it('offers the consume button only when there is something to consume', () => {
    const { unmount } = renderRow({ quantity_available: 2 })
    expect(screen.getByRole('button', { name: /consume 1 unit/i })).toBeInTheDocument()
    unmount()

    renderRow({ quantity_available: 0 })
    expect(screen.queryByRole('button', { name: /consume 1 unit/i })).not.toBeInTheDocument()
  })

  it('calls onConsume without navigating when the consume button is pressed', async () => {
    const onConsume = vi.fn()
    const user = userEvent.setup()
    renderRow({}, { onConsume })
    await user.click(screen.getByRole('button', { name: /consume 1 unit/i }))
    expect(onConsume).toHaveBeenCalledTimes(1)
    expect(onConsume.mock.calls[0][0].id).toBe(1)
  })

  it('disables the consume button while a consumption is in flight', () => {
    renderRow({}, { consuming: true })
    expect(screen.getByRole('button', { name: /consume 1 unit/i })).toBeDisabled()
  })

  it('keeps the open-details button, which e2e navigates by', () => {
    renderRow()
    expect(screen.getByRole('button', { name: /open details/i })).toBeInTheDocument()
  })

  it('marks a shared stock as owner when the viewer owns it', () => {
    renderRow({ shared_with: [2], is_owner: true })
    expect(screen.getByTestId('shared-badge')).toHaveAttribute('data-variant', 'owner')
  })

  it('marks a shared stock as recipient when the viewer does not own it', () => {
    renderRow({ shared_with: [], is_owner: false, owner_display_name: 'María' })
    const badge = screen.getByTestId('shared-badge')
    expect(badge).toHaveAttribute('data-variant', 'recipient')
    expect(badge).toHaveAccessibleName(/María/)
  })

  it('names the recipient badge without an owner when the name is missing', () => {
    // `owner_display_name` is absent from cold-cache snapshots; the label
    // must still render rather than interpolating "undefined".
    renderRow({ shared_with: [], is_owner: false, owner_display_name: undefined })
    const badge = screen.getByTestId('shared-badge')
    expect(badge).toHaveAttribute('data-variant', 'recipient')
    expect(badge.getAttribute('aria-label')).not.toMatch(/undefined/)
  })

  // `vitest.config.js` sets `classNameStrategy: 'non-scoped'`, so CSS module
  // classes keep their literal names and can be asserted on directly.
  it('pulses the quantity after a consumption', () => {
    renderRow({}, { flashing: true })
    expect(screen.getByText(/5 u\./)).toHaveClass('stockQtyFlash')
  })

  it('does not pulse the quantity at rest', () => {
    renderRow({}, { flashing: false })
    expect(screen.getByText(/5 u\./)).not.toHaveClass('stockQtyFlash')
  })

  it('shows no shared badge for a stock that is not shared', () => {
    renderRow()
    expect(screen.queryByTestId('shared-badge')).not.toBeInTheDocument()
  })
})

describe('StockRow — line 2', () => {
  it('stays a single line when there is no consumption rate', () => {
    renderRow({ daily_consumption_own: 0, daily_consumption_shared: 0, estimated_depletion_date: '2026-09-01' })
    expect(screen.queryByTestId('consumption-row')).not.toBeInTheDocument()
    // Even a known depletion date does not bring the line back: with no rate
    // behind it the date is not something the user can act on.
    expect(screen.queryByTestId('depletion-date')).not.toBeInTheDocument()
  })

  it('reports the own rate as a monthly figure', () => {
    renderRow({ daily_consumption_own: 0.04 })
    expect(screen.getByTestId('consumption-row')).toBeInTheDocument()
    expect(screen.getByText('1.2/month')).toBeInTheDocument()
  })

  it('reports own and shared rates side by side', () => {
    renderRow({ daily_consumption_own: 0.1, daily_consumption_shared: 0.2 })
    expect(screen.getByText('3/month')).toBeInTheDocument()
    expect(screen.getByText('6/month (shared)')).toBeInTheDocument()
  })

  it('reports a shared-only rate without an own figure', () => {
    renderRow({ daily_consumption_own: 0, daily_consumption_shared: 0.2 })
    expect(screen.getByText('6/month (shared)')).toBeInTheDocument()
    expect(screen.queryByText(/^6\/month$/)).not.toBeInTheDocument()
  })

  it('marks an estimated depletion with the approximation icon', () => {
    renderRow({ daily_consumption_own: 0.1, depletion_is_estimated: true })
    expect(screen.getByTestId('estimated-icon')).toBeInTheDocument()
  })

  it('omits the approximation icon when the estimate is not heuristic', () => {
    renderRow({ daily_consumption_own: 0.1, depletion_is_estimated: false })
    expect(screen.queryByTestId('estimated-icon')).not.toBeInTheDocument()
  })

  it('shows the depletion date, right-aligned, when there is stock left', () => {
    renderRow({ daily_consumption_own: 0.1, estimated_depletion_date: '2026-10-27' })
    expect(screen.getByTestId('depletion-date')).toBeInTheDocument()
    expect(screen.queryByTestId('out-of-stock-footer')).not.toBeInTheDocument()
  })

  it.each([
    ['ok', 'stockOk', []],
    ['low', 'stockLow', ['depletionWarning']],
    // Critical with stock left is real: depletion under 7 days qualifies even
    // when units remain, so this is not the out-of-stock branch.
    ['critical', 'stockCritical', ['depletionDanger']],
  ])('tints the depletion date for %s stock', (severity, _label, expectedClasses) => {
    renderRow({
      daily_consumption_own: 0.1,
      stock_severity: severity,
      quantity_available: 3,
      estimated_depletion_date: '2026-10-27',
    })
    const date = screen.getByTestId('depletion-date')
    expect(date).toHaveClass('depletion')
    for (const cls of ['depletionWarning', 'depletionDanger']) {
      if (expectedClasses.includes(cls)) expect(date).toHaveClass(cls)
      else expect(date).not.toHaveClass(cls)
    }
  })

  it('replaces the date with an out-of-stock note when nothing is available', () => {
    renderRow({
      daily_consumption_own: 0.1,
      quantity_available: 0,
      quantity: 0,
      estimated_depletion_date: '2026-10-27',
    })
    expect(screen.getByTestId('out-of-stock-footer')).toBeInTheDocument()
    expect(screen.queryByTestId('depletion-date')).not.toBeInTheDocument()
  })

  it('omits the depletion slot entirely when no date is known', () => {
    renderRow({ daily_consumption_own: 0.1, estimated_depletion_date: null })
    expect(screen.getByTestId('consumption-row')).toBeInTheDocument()
    expect(screen.queryByTestId('depletion-date')).not.toBeInTheDocument()
    expect(screen.queryByTestId('out-of-stock-footer')).not.toBeInTheDocument()
  })
})

describe('StockRow — expiry warning', () => {
  it('warns once when expiry has been reached', () => {
    renderRow({ daily_consumption_own: 0.1, expiry_severity: 'reached' })
    const warnings = screen.getAllByTestId('row-expiry-warning')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toHaveTextContent('expired')
  })

  it('warns once when expiry is near', () => {
    renderRow({ daily_consumption_own: 0.1, expiry_severity: 'soon' })
    const warnings = screen.getAllByTestId('row-expiry-warning')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toHaveTextContent('expiring')
  })

  it('lets reached outrank soon, never showing both', () => {
    // `expiry_severity` is a single backend verdict, but the row must not
    // depend on that to stay at one warning.
    renderRow({ daily_consumption_own: 0.1, expiry_severity: 'reached' })
    expect(screen.getAllByTestId('row-expiry-warning')).toHaveLength(1)
    expect(screen.queryByText('expiring')).not.toBeInTheDocument()
  })

  it('shows no warning when expiry is healthy', () => {
    renderRow({ daily_consumption_own: 0.1, expiry_severity: 'none' })
    expect(screen.queryByTestId('row-expiry-warning')).not.toBeInTheDocument()
  })

  it('is independent of stock severity, which the dot carries', () => {
    // A critically low stock whose batches are all fine gets no expiry
    // warning: the two axes were decoupled on purpose.
    renderRow({ daily_consumption_own: 0.1, stock_severity: 'critical', expiry_severity: 'none' })
    expect(screen.queryByTestId('row-expiry-warning')).not.toBeInTheDocument()
  })
})

describe('StockRow — navigation', () => {
  // MemoryRouter keeps history in memory, so navigation is asserted through
  // the route that renders, not through `window.location`.
  const renderRouted = (over = {}, props = {}) =>
    renderWithProviders(
      <Routes>
        <Route
          path="/inventory"
          element={<StockRow stock={stock(over)} consuming={false} onConsume={vi.fn()} {...props} />}
        />
        <Route path="/inventory/:id" element={<div>Detail stub</div>} />
      </Routes>,
      { initialEntries: ['/inventory'] },
    )

  it('opens the detail when the row itself is clicked', async () => {
    const user = userEvent.setup()
    renderRouted({ id: 42 })
    await user.click(screen.getByText('Water filter'))
    expect(await screen.findByText('Detail stub')).toBeInTheDocument()
  })

  it('opens the detail from the chevron button', async () => {
    const user = userEvent.setup()
    renderRouted({ id: 42 })
    await user.click(screen.getByRole('button', { name: /open details/i }))
    expect(await screen.findByText('Detail stub')).toBeInTheDocument()
  })

  it('does not navigate when the consume button is pressed', async () => {
    const user = userEvent.setup()
    const onConsume = vi.fn()
    renderRouted({ id: 42 }, { onConsume })
    await user.click(screen.getByRole('button', { name: /consume 1 unit/i }))
    expect(onConsume).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Detail stub')).not.toBeInTheDocument()
  })

  it('does not navigate when the shared badge is clicked', async () => {
    const user = userEvent.setup()
    renderRouted({ id: 42, shared_with: [2] })
    await user.click(screen.getByTestId('shared-badge'))
    expect(screen.queryByText('Detail stub')).not.toBeInTheDocument()
  })
})
