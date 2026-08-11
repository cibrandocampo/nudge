import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import LotRow, { LotQty, LotRowList, LotRowShell } from '../LotRow'

// Fixed "today" so expiry severity never depends on when the suite runs.
const today = new Date('2026-06-01')

const group = (overrides = {}) => ({
  key: 'LOT-A|',
  quantity: 3,
  expiry_date: null,
  lot_number: 'LOT-A',
  ...overrides,
})

describe('LotRow', () => {
  it('renders the quantity, the expiry and the batch pill', () => {
    renderWithProviders(<LotRow group={group({ expiry_date: '2026-09-30' })} today={today} testId="lot-row" />)

    const row = screen.getByTestId('lot-row')
    expect(within(row).getByText('3 u.')).toBeInTheDocument()
    expect(within(row).getByText('LOT-A')).toBeInTheDocument()
    expect(row).toHaveTextContent('exp. 30 Sept 2026')
  })

  it('omits the expiry when the group has none, instead of rendering an empty cell', () => {
    const { container } = renderWithProviders(<LotRow group={group()} today={today} testId="lot-row" />)

    expect(container.querySelector('[class*="cardLotExpiry"]')).toBeNull()
    expect(screen.getByTestId('lot-row')).toHaveAttribute('data-expiring', 'none')
  })

  it('omits the pill when the group has no batch number', () => {
    const { container } = renderWithProviders(
      <LotRow group={group({ lot_number: null })} today={today} testId="lot-row" />,
    )

    expect(container.querySelector('[class*="cardLotNumberPill"]')).toBeNull()
  })

  it('marks a reached expiry and strikes the quantity through', () => {
    const { container } = renderWithProviders(
      <LotRow group={group({ expiry_date: '2026-05-01' })} today={today} testId="lot-row" />,
    )

    expect(screen.getByTestId('lot-row')).toHaveAttribute('data-expiring', 'reached')
    expect(container.querySelector('[class*="cardLotQty"]').getAttribute('class')).toContain('cardLotQtyExpired')
  })

  it('tints a soon-expiring row without striking it through', () => {
    const { container } = renderWithProviders(
      <LotRow group={group({ expiry_date: '2026-06-20' })} today={today} testId="lot-row" />,
    )

    expect(screen.getByTestId('lot-row')).toHaveAttribute('data-expiring', 'soon')
    expect(container.querySelector('[class*="cardLotExpiry"]').getAttribute('class')).toContain('iconWarning')
    expect(container.querySelector('[class*="cardLotQty"]').getAttribute('class')).not.toContain('cardLotQtyExpired')
  })

  it('emits whichever testId the list gives it', () => {
    // The two real call sites are `lot-row` and `pack-row`, both in
    // `StockLotsList`; the point here is that the value is pass-through.
    renderWithProviders(<LotRow group={group()} today={today} testId="pack-row" />)

    expect(screen.getByTestId('pack-row')).toBeInTheDocument()
    expect(screen.queryByTestId('lot-row')).not.toBeInTheDocument()
  })

  it('renders a trailing control when given one, and nothing when not', () => {
    const { container: withControl } = renderWithProviders(
      <LotRow group={group()} today={today} testId="lot-row">
        <button type="button">Delete</button>
      </LotRow>,
    )
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(withControl.querySelector('[class*="trailing"]')).not.toBeNull()

    const { container: bare } = renderWithProviders(<LotRow group={group()} today={today} testId="pack-row" />)
    // No empty wrapper: a read-only list must not carry a trailing cell.
    expect(bare.querySelector('[class*="trailing"]')).toBeNull()
  })
})

describe('LotRowList', () => {
  it('switches to pill layout when some lot carries a batch number', () => {
    const { container } = renderWithProviders(
      <LotRowList lots={[{ lot_number: '' }, { lot_number: 'LOT-A' }]}>
        <span>row</span>
      </LotRowList>,
    )

    expect(container.querySelector('[data-with-pills]')).not.toBeNull()
  })

  it('stays flat when no lot carries one — the caller never computes this', () => {
    const { container } = renderWithProviders(
      <LotRowList lots={[{ lot_number: '' }, {}]}>
        <span>row</span>
      </LotRowList>,
    )

    expect(container.querySelector('[data-with-pills]')).toBeNull()
  })

  it('tolerates a stock with no lots array at all', () => {
    const { container } = renderWithProviders(
      <LotRowList lots={undefined}>
        <span>row</span>
      </LotRowList>,
    )

    expect(container.querySelector('[data-with-pills]')).toBeNull()
  })

  it('declares the trailing column only when its rows have one', () => {
    const { container: withTrailing } = renderWithProviders(
      <LotRowList lots={[{ lot_number: 'LOT-A' }]} trailing>
        <span>row</span>
      </LotRowList>,
    )
    expect(withTrailing.querySelector('[data-trailing]')).not.toBeNull()

    const { container: readOnly } = renderWithProviders(
      <LotRowList lots={[{ lot_number: 'LOT-A' }]}>
        <span>row</span>
      </LotRowList>,
    )
    expect(readOnly.querySelector('[data-trailing]')).toBeNull()
  })
})

describe('LotRowShell', () => {
  it('lays out arbitrary cell content and passes extra attributes through', () => {
    renderWithProviders(
      <LotRowShell
        testId="pack-row"
        expiring="none"
        data-lot-id={42}
        main={<LotQty>1 u.</LotQty>}
        meta={<span>SN-1</span>}
        trailing={<button type="button">Delete</button>}
      />,
    )

    const row = screen.getByTestId('pack-row')
    expect(row).toHaveAttribute('data-lot-id', '42')
    expect(within(row).getByText('1 u.')).toBeInTheDocument()
    expect(within(row).getByText('SN-1')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })
})

describe('LotQty', () => {
  it('strikes through only when the units are expired', () => {
    const { container } = renderWithProviders(
      <>
        <LotQty>3 u.</LotQty>
        <LotQty expired>1 u.</LotQty>
      </>,
    )

    const [plain, expired] = container.querySelectorAll('[class*="cardLotQty"]')
    expect(plain.getAttribute('class')).not.toContain('cardLotQtyExpired')
    expect(expired.getAttribute('class')).toContain('cardLotQtyExpired')
  })
})
