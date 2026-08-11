import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/helpers'
import InventoryAlertBanner from '../InventoryAlertBanner'

const TODAY = new Date(new Date().toISOString().slice(0, 10))
const daysFromNow = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
const PAST = '2026-04-20'
const SOON = daysFromNow(15)

const stock = (over = {}) => ({
  id: 1,
  name: 'Water filter',
  quantity: 5,
  quantity_available: 5,
  stock_severity: 'ok',
  expiry_severity: 'none',
  estimated_depletion_date: null,
  lots: [],
  ...over,
})

const renderBanner = (stocks) => renderWithProviders(<InventoryAlertBanner stocks={stocks} today={TODAY} />)

describe('InventoryAlertBanner', () => {
  it('renders nothing when no stock needs attention', () => {
    renderBanner([stock()])
    expect(screen.queryByTestId('inventory-alert-banner')).not.toBeInTheDocument()
  })

  it('starts collapsed, showing only the count', async () => {
    renderBanner([
      stock({ id: 1, stock_severity: 'critical', quantity_available: 0 }),
      stock({ id: 2, name: 'Aspirin', stock_severity: 'low' }),
    ])
    expect(screen.getByTestId('inventory-alert-banner')).toBeInTheDocument()
    expect(screen.getByText(/2 products need attention/i)).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('inventory-alert-row')).not.toBeInTheDocument()
  })

  it('uses the singular form for a single affected product', () => {
    renderBanner([stock({ stock_severity: 'critical', quantity_available: 0 })])
    expect(screen.getByText(/1 product needs attention/i)).toBeInTheDocument()
  })

  it('expands on click and collapses again', async () => {
    const user = userEvent.setup()
    renderBanner([stock({ stock_severity: 'critical', quantity_available: 0 })])

    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByTestId('inventory-alert-row')).toHaveLength(1)

    await user.click(screen.getByRole('button'))
    expect(screen.queryByTestId('inventory-alert-row')).not.toBeInTheDocument()
  })

  it('links each row to that product detail page', async () => {
    const user = userEvent.setup()
    renderBanner([
      stock({ id: 7, name: 'Aspirin', stock_severity: 'critical', quantity_available: 0 }),
      stock({ id: 9, name: 'Zinc', stock_severity: 'low' }),
    ])
    await user.click(screen.getByRole('button'))

    const rows = screen.getAllByTestId('inventory-alert-row')
    expect(rows[0]).toHaveAttribute('href', '/inventory/7')
    expect(rows[1]).toHaveAttribute('href', '/inventory/9')
  })

  it('gives a product with two problems one row carrying both labels', async () => {
    const user = userEvent.setup()
    renderBanner([
      stock({
        name: 'Ibuprofen',
        stock_severity: 'critical',
        quantity_available: 0,
        expiry_severity: 'reached',
        lots: [{ id: 99, quantity: 1, expiry_date: PAST }],
      }),
    ])
    await user.click(screen.getByRole('button'))

    const rows = screen.getAllByTestId('inventory-alert-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveAttribute('data-severity', 'danger')
    expect(within(rows[0]).getByText(/critical stock \(0 u\.\)/i)).toBeInTheDocument()
    expect(within(rows[0]).getByText(/1 expired batch/i)).toBeInTheDocument()
  })

  it('formats the date inside a label that carries one', async () => {
    const user = userEvent.setup()
    renderBanner([
      stock({
        name: 'Vitamin D',
        expiry_severity: 'soon',
        lots: [{ id: 1, quantity: 2, expiry_date: SOON }],
      }),
    ])
    await user.click(screen.getByRole('button'))

    const row = screen.getByTestId('inventory-alert-row')
    expect(row).toHaveAttribute('data-severity', 'warning')
    // Rendered through `formatShortDate`, so the raw ISO string must be gone.
    expect(within(row).queryByText(new RegExp(SOON))).not.toBeInTheDocument()
    expect(within(row).getByText(/1 batch expires /i)).toBeInTheDocument()
  })

  it('does not remember being open across mounts', async () => {
    const user = userEvent.setup()
    const stocks = [stock({ stock_severity: 'critical', quantity_available: 0 })]
    const { unmount } = renderBanner(stocks)
    await user.click(screen.getByRole('button'))
    expect(screen.getByTestId('inventory-alert-row')).toBeInTheDocument()
    unmount()

    renderBanner(stocks)
    expect(screen.queryByTestId('inventory-alert-row')).not.toBeInTheDocument()
  })
})
