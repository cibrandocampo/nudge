import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import { expiryToday, lotsForSelection } from '../../utils/lotsForSelection'
import LotConsumeModal from '../LotConsumeModal'
import LotPickerModal from '../LotPickerModal'

const BASE = 'http://localhost/api'

// Only `Date` is faked: the picker drops expired batches against today, and a
// frozen today keeps the fixtures' expiries valid however long the suite lives.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-06-01T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

function buildStock(overrides = {}) {
  return {
    id: 5,
    name: 'Water filter',
    quantity: 6,
    lots: [
      { id: 10, quantity: 3, expiry_date: '2027-01-01', lot_number: 'LOT-A' },
      { id: 11, quantity: 3, expiry_date: '2028-01-01', lot_number: 'LOT-B' },
    ],
    ...overrides,
  }
}

function renderModal(props = {}) {
  return renderWithProviders(
    <LotPickerModal stock={buildStock()} onClose={() => {}} onConsumed={() => {}} {...props} />,
  )
}

describe('LotPickerModal', () => {
  it('renders lots FEFO-ordered with the first preselected', () => {
    renderModal()
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(2)
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')
    expect(radios[1]).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('LOT-A')).toBeInTheDocument()
    expect(screen.getByText('LOT-B')).toBeInTheDocument()
  })

  it('changes selection and sends the chosen lot_id to the consume endpoint', async () => {
    let receivedBody = null
    server.use(
      http.post(`${BASE}/stock/5/consume/`, async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({ id: 5, name: 'Water filter', quantity: 5, lots: [] })
      }),
    )

    const { user } = renderModal()
    const radios = screen.getAllByRole('radio')
    await user.click(radios[1])
    await user.click(screen.getByRole('button', { name: /consume 1/i }))

    await waitFor(() => expect(receivedBody).not.toBeNull())
    expect(receivedBody.quantity).toBe(1)
    expect(receivedBody.lot_selections).toEqual([{ lot_id: 11, quantity: 1 }])
  })

  it('cancels without firing the mutation', async () => {
    let consumeCalls = 0
    server.use(
      http.post(`${BASE}/stock/5/consume/`, () => {
        consumeCalls += 1
        return HttpResponse.json({})
      }),
    )
    const onClose = vi.fn()
    const { user } = renderModal({ onClose })
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(consumeCalls).toBe(0)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('surfaces a server error without closing the modal', async () => {
    server.use(http.post(`${BASE}/stock/5/consume/`, () => new HttpResponse(null, { status: 500 })))
    const onClose = vi.fn()
    const { user } = renderModal({ onClose })
    await user.click(screen.getByRole('button', { name: /consume 1/i }))
    expect(await screen.findByText(/could not consume/i)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows a coded refusal (422 insufficient_stock) with its numbers instead of the generic copy', async () => {
    server.use(
      http.post(`${BASE}/stock/5/consume/`, () =>
        HttpResponse.json(
          { detail: 'Insufficient stock.', code: 'insufficient_stock', required: 1, available: 0 },
          { status: 422 },
        ),
      ),
    )
    const onClose = vi.fn()
    const { user } = renderModal({ onClose })
    await user.click(screen.getByRole('button', { name: /consume 1/i }))
    expect(await screen.findByText('Not enough stock (1 needed, 0 available).')).toBeInTheDocument()
    expect(screen.queryByText(/could not consume/i)).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('says the batch is gone when it was emptied after the picker opened (422 lot_unavailable)', async () => {
    server.use(
      http.post(`${BASE}/stock/5/consume/`, () =>
        HttpResponse.json(
          { detail: 'Lot no longer available.', code: 'lot_unavailable', lot_ids: [10] },
          { status: 422 },
        ),
      ),
    )
    const onClose = vi.fn()
    const { user } = renderModal({ onClose })
    await user.click(screen.getByRole('button', { name: /consume 1/i }))
    expect(await screen.findByText('This batch is no longer available.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes via onClose after a successful consume', async () => {
    server.use(http.post(`${BASE}/stock/5/consume/`, () => HttpResponse.json({ ok: true })))
    const onClose = vi.fn()
    const onConsumed = vi.fn()
    const { user } = renderModal({ onClose, onConsumed })
    await user.click(screen.getByRole('button', { name: /consume 1/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onConsumed).toHaveBeenCalledTimes(1)
  })

  it('uses the "(no id)" fallback label when a lot has no lot_number', () => {
    const stock = buildStock({
      lots: [{ id: 20, quantity: 1, expiry_date: '2027-01-01', lot_number: null }],
    })
    renderModal({ stock })
    expect(screen.getByText(/no id/i)).toBeInTheDocument()
  })

  it('renders the no-lots copy when the stock has no available batches', () => {
    renderModal({ stock: buildStock({ lots: [] }) })
    expect(screen.getByText(/no available batches/i)).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /consume 1/i })).toBeDisabled()
  })

  // ── The lot, never the box ────────────────────────────────────────────────

  // Two boxes of one batch: a full one scanned first, the opened one after.
  const twoBoxesStock = () =>
    buildStock({
      lots: [
        {
          id: 30,
          quantity: 10,
          expiry_date: '2028-06-01',
          lot_number: 'LOT-S',
          serial_number: 'SN-1',
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 31,
          quantity: 4,
          expiry_date: '2028-06-01',
          lot_number: 'LOT-S',
          serial_number: 'SN-2',
          created_at: '2026-01-02T00:00:00Z',
        },
      ],
    })

  it('shows two boxes of the same batch as a single lot row', () => {
    renderModal({ stock: twoBoxesStock() })
    expect(screen.getAllByTestId('lot-group-row')).toHaveLength(1)
    expect(screen.getByText(/14 available/)).toBeInTheDocument()
  })

  it('consumes from the opened box, with no box step', async () => {
    let receivedBody = null
    server.use(
      http.post(`${BASE}/stock/5/consume/`, async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )
    const { user } = renderModal({ stock: twoBoxesStock() })
    await user.click(screen.getByRole('button', { name: /consume 1/i }))

    await waitFor(() => expect(receivedBody).not.toBeNull())
    expect(receivedBody.lot_selections).toEqual([{ lot_id: 31, quantity: 1 }])
  })

  it('does not offer an expired batch', () => {
    const stock = buildStock({
      lots: [
        { id: 70, quantity: 2, expiry_date: '2026-03-01', lot_number: 'LOT-OLD' },
        { id: 71, quantity: 2, expiry_date: '2028-06-01', lot_number: 'LOT-NEW' },
      ],
    })
    renderModal({ stock })
    expect(screen.getAllByRole('radio')).toHaveLength(1)
    expect(screen.queryByText('LOT-OLD')).not.toBeInTheDocument()
    expect(screen.getByText('LOT-NEW')).toBeInTheDocument()
  })

  // Every row is a `<li role="radio" tabIndex={0}>`, so a keyboard user
  // reaches it by Tab and expects Enter to choose it. Only Enter: the list is
  // navigated with Tab, so swallowing other keys would trap the focus ring.

  it('selects a batch row with Enter, and ignores other keys', async () => {
    const { user } = renderModal({ stock: buildStock() })
    const [first, second] = screen.getAllByTestId('lot-group-row')
    second.focus()
    await user.keyboard('{Enter}')
    expect(second).toHaveAttribute('aria-checked', 'true')
    expect(first).toHaveAttribute('aria-checked', 'false')

    first.focus()
    await user.keyboard(' ')
    expect(second).toHaveAttribute('aria-checked', 'true')
  })

  it('refuses to close while the consume is in flight', async () => {
    // Never resolves: the modal stays in its submitting state for the whole test.
    server.use(http.post(`${BASE}/stock/5/consume/`, () => new Promise(() => {})))
    const onClose = vi.fn()
    const { user } = renderModal({ onClose })
    await user.click(screen.getByRole('button', { name: /consume 1/i }))
    await screen.findByRole('button', { name: /consuming/i })

    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })
})

// The picker and a one-unit routine confirmation are the same flow reached from
// two places. This is what "the same flow" has to mean concretely: identical
// batches and identical clicks produce byte-identical `lot_selections`. A
// divergence here would be the two entry points drifting apart again.
describe('LotPickerModal — parity with the routine entry point', () => {
  const batches = [
    { id: 30, quantity: 10, expiry_date: '2028-06-01', lot_number: 'LOT-S', serial_number: 'SN-1' },
    { id: 31, quantity: 4, expiry_date: '2028-06-01', lot_number: 'LOT-S', serial_number: 'SN-2' },
    { id: 32, quantity: 4, expiry_date: '2028-09-01', lot_number: 'LOT-T', serial_number: '' },
  ]

  it('sends what the routine flow would confirm for the same single unit', async () => {
    const stock = buildStock({ lots: batches })
    let receivedBody = null
    server.use(
      http.post(`${BASE}/stock/5/consume/`, async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )

    const picker = renderWithProviders(<LotPickerModal stock={stock} onClose={() => {}} onConsumed={() => {}} />)
    await picker.user.click(screen.getByRole('button', { name: /consume 1/i }))
    await waitFor(() => expect(receivedBody).not.toBeNull())
    picker.unmount()

    const onConfirm = vi.fn()
    const routine = renderWithProviders(
      <LotConsumeModal
        groups={lotsForSelection(stock, expiryToday())}
        needed={1}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    )
    await routine.user.click(screen.getByText('Confirm'))

    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 31, quantity: 1 }])
    expect(onConfirm).toHaveBeenCalledWith(receivedBody.lot_selections)
  })
})
