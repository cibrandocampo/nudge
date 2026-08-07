import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import StockValuesConfirmModal from '../StockValuesConfirmModal'

const GTIN = '05705244020856'

const renderModal = (discrepancies, props = {}) =>
  renderWithProviders(
    <StockValuesConfirmModal
      discrepancies={discrepancies}
      onConfirm={props.onConfirm ?? vi.fn()}
      onCancel={props.onCancel ?? vi.fn()}
    />,
  )

describe('StockValuesConfirmModal', () => {
  it('shows both values for a single discrepancy', () => {
    renderModal([{ field: 'default_lot_quantity', current: 10, next: 6 }])

    const row = screen.getByTestId('stock-values-row')
    expect(within(row).getByTestId('stock-values-current')).toHaveTextContent('10')
    expect(within(row).getByTestId('stock-values-next')).toHaveTextContent('6')
  })

  it('renders one row per discrepancy, not just the first', () => {
    renderModal([
      { field: 'gtin', current: GTIN, next: '08470007285144' },
      { field: 'default_lot_quantity', current: 10, next: 6 },
    ])

    expect(screen.getAllByTestId('stock-values-row')).toHaveLength(2)
  })

  it('keeps a GTIN leading zero intact', () => {
    // The value is a string precisely because `05705244020856` loses meaning
    // the moment anything treats it as a number.
    renderModal([{ field: 'gtin', current: GTIN, next: '08470007285144' }])

    const current = screen.getByTestId('stock-values-current')
    expect(current).toHaveTextContent(GTIN)
    expect(current.textContent).toMatch(/^0/)
  })

  it('fires the matching callback exactly once per button', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { user } = renderModal([{ field: 'default_lot_quantity', current: 10, next: 6 }], {
      onConfirm,
      onCancel,
    })

    await user.click(screen.getByTestId('stock-values-update'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('stock-values-keep'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('uses no destructive styling: the lot is saved either way', () => {
    renderModal([{ field: 'default_lot_quantity', current: 10, next: 6 }])

    for (const testid of ['stock-values-update', 'stock-values-keep']) {
      expect(screen.getByTestId(testid).className).not.toMatch(/Danger/i)
    }
  })

  it('falls back to the raw field name for an unknown field', () => {
    // Guards the label map: an unmapped field must not render a missing
    // translation key at the user.
    renderModal([{ field: 'future_field', current: 'a', next: 'b' }])

    expect(screen.getByText('future_field')).toBeInTheDocument()
  })

  it('renders a dash rather than "undefined" for a blank current value', () => {
    // Should not happen — the helper routes blanks to `silent` — but printing
    // `undefined` would be a worse bug than an em dash.
    renderModal([{ field: 'gtin', current: undefined, next: GTIN }])

    expect(screen.getByTestId('stock-values-current')).toHaveTextContent('—')
  })
})
