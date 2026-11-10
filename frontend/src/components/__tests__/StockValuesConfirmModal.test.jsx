import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import StockValuesConfirmModal from '../StockValuesConfirmModal'

const GTIN = '05705244020856'

const renderModal = (discrepancies, props = {}) =>
  renderWithProviders(
    <StockValuesConfirmModal
      {...props}
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

describe('StockValuesConfirmModal — reuse for the official-name offer (T112)', () => {
  it('labels the name and the national code', () => {
    renderModal([
      { field: 'name', current: 'Insulin', next: 'FIASP 100 UNIDADES/ML' },
      { field: 'national_code', current: '728514', next: '661426' },
    ])
    const rows = screen.getAllByTestId('stock-values-row')
    expect(rows[0]).toHaveTextContent('Name')
    expect(rows[1]).toHaveTextContent('National code (CN)')
  })

  it('takes its own title and an interpolated intro', () => {
    renderModal([{ field: 'name', current: 'Insulin', next: 'FIASP' }], {
      title: 'stockValues.nameOfferTitle',
      intro: 'stockValues.nameOfferIntro',
      introValues: { source: 'AEMPS (CIMA)' },
    })
    expect(screen.getByText('Use the official name?')).toBeInTheDocument()
    expect(screen.getByText(/according to AEMPS \(CIMA\)/)).toBeInTheDocument()
  })

  it('keeps the lot wording by default', () => {
    renderModal([{ field: 'default_lot_quantity', current: 10, next: 6 }])
    expect(screen.getByText('Update the product?')).toBeInTheDocument()
  })

  it('holds both actions while an answer is in flight', () => {
    renderModal([{ field: 'name', current: 'a', next: 'b' }], { busy: true })
    expect(screen.getByTestId('stock-values-keep')).toBeDisabled()
    expect(screen.getByTestId('stock-values-update')).toBeDisabled()
  })

  it('closing with Escape dismisses without answering when onDismiss is given', () => {
    const onCancel = vi.fn()
    const onDismiss = vi.fn()
    renderModal([{ field: 'name', current: 'a', next: 'b' }], { onCancel, onDismiss })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('closing with Escape still means "keep" for the lot question', () => {
    const onCancel = vi.fn()
    renderModal([{ field: 'gtin', current: GTIN, next: '08470007285144' }], { onCancel })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
