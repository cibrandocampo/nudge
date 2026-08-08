import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import { lotsForSelection } from '../../utils/lotsForSelection'
import LotConsumeModal from '../LotConsumeModal'
import LotPickerModal from '../LotPickerModal'

const BASE = 'http://localhost/api'

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

  // ── Serialized packs ──────────────────────────────────────────────────────

  const serializedStock = () =>
    buildStock({
      lots: [
        { id: 30, quantity: 1, expiry_date: '2028-06-01', lot_number: 'LOT-S', serial_number: 'SN-1' },
        { id: 31, quantity: 1, expiry_date: '2028-06-01', lot_number: 'LOT-S', serial_number: 'SN-2' },
      ],
    })

  it('shows two packs of the same batch as a single lot row', () => {
    renderModal({ stock: serializedStock() })
    expect(screen.getAllByTestId('lot-group-row')).toHaveLength(1)
    expect(screen.getByText(/2 available/)).toBeInTheDocument()
  })

  it('asks which pack and consumes exactly that box', async () => {
    let receivedBody = null
    server.use(
      http.post(`${BASE}/stock/5/consume/`, async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({ id: 5, name: 'Water filter', quantity: 1, lots: [] })
      }),
    )

    const { user } = renderModal({ stock: serializedStock() })
    await user.click(screen.getByRole('button', { name: /consume 1/i }))
    expect(screen.getByText('Which pack?')).toBeInTheDocument()

    await user.click(screen.getByText('SN-2'))
    await user.click(screen.getByTestId('pack-confirm'))

    await waitFor(() => expect(receivedBody).not.toBeNull())
    expect(receivedBody.lot_selections).toEqual([{ lot_id: 31, quantity: 1 }])
  })

  it('consumes straight away for a batch without serials', async () => {
    let receivedBody = null
    server.use(
      http.post(`${BASE}/stock/5/consume/`, async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )
    const { user } = renderModal()
    await user.click(screen.getByRole('button', { name: /consume 1/i }))
    expect(screen.queryByText('Which pack?')).not.toBeInTheDocument()
    await waitFor(() => expect(receivedBody).not.toBeNull())
    expect(receivedBody.lot_selections).toEqual([{ lot_id: 10, quantity: 1 }])
  })

  it('does not ask which pack when the batch holds a single identified box', async () => {
    let receivedBody = null
    server.use(
      http.post(`${BASE}/stock/5/consume/`, async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )
    const stock = buildStock({
      // Ten pills, one serial: consuming one needs no confirmation.
      lots: [{ id: 50, quantity: 10, expiry_date: '2028-06-01', lot_number: 'LOT-ONE', serial_number: 'SN-ONLY' }],
    })
    const { user } = renderModal({ stock })
    await user.click(screen.getByRole('button', { name: /consume 1/i }))

    expect(screen.queryByText('Which pack?')).not.toBeInTheDocument()
    await waitFor(() => expect(receivedBody).not.toBeNull())
    expect(receivedBody.lot_selections).toEqual([{ lot_id: 50, quantity: 1 }])
  })

  it('goes back from the pack step to the lot list', async () => {
    const { user } = renderModal({ stock: serializedStock() })
    await user.click(screen.getByRole('button', { name: /consume 1/i }))
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByText(/select the batch to consume/i)).toBeInTheDocument()
  })

  it('lets the user consume an unidentified unit from a mixed batch', async () => {
    let receivedBody = null
    server.use(
      http.post(`${BASE}/stock/5/consume/`, async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )
    const stock = buildStock({
      lots: [
        { id: 40, quantity: 1, expiry_date: '2028-06-01', lot_number: 'LOT-M', serial_number: 'SN-9' },
        { id: 42, quantity: 1, expiry_date: '2028-06-01', lot_number: 'LOT-M', serial_number: 'SN-10' },
        { id: 41, quantity: 4, expiry_date: '2028-06-01', lot_number: 'LOT-M', serial_number: '' },
      ],
    })
    const { user } = renderModal({ stock })
    await user.click(screen.getByRole('button', { name: /consume 1/i }))
    await user.click(screen.getByTestId('bulk-row'))
    await user.click(screen.getByTestId('pack-confirm'))

    await waitFor(() => expect(receivedBody).not.toBeNull())
    expect(receivedBody.lot_selections).toEqual([{ lot_id: 41, quantity: 1 }])
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

  it('selects a pack row with Enter, and ignores other keys', async () => {
    const { user } = renderModal({ stock: serializedStock() })
    await user.click(screen.getByRole('button', { name: /consume 1/i }))
    const [first, second] = screen.getAllByTestId('pack-row')
    second.focus()
    await user.keyboard('{Enter}')
    expect(second).toHaveAttribute('aria-checked', 'true')

    first.focus()
    await user.keyboard('a')
    expect(second).toHaveAttribute('aria-checked', 'true')
  })

  it('selects the unidentified-units row with Enter', async () => {
    const stock = buildStock({
      lots: [
        { id: 60, quantity: 1, expiry_date: '2028-06-01', lot_number: 'LOT-K', serial_number: 'SN-A' },
        { id: 61, quantity: 1, expiry_date: '2028-06-01', lot_number: 'LOT-K', serial_number: 'SN-B' },
        { id: 62, quantity: 3, expiry_date: '2028-06-01', lot_number: 'LOT-K', serial_number: '' },
      ],
    })
    const { user } = renderModal({ stock })
    await user.click(screen.getByRole('button', { name: /consume 1/i }))
    const bulk = screen.getByTestId('bulk-row')
    bulk.focus()
    await user.keyboard('{Enter}')
    expect(bulk).toHaveAttribute('aria-checked', 'true')
  })

  it('surfaces a server error on the pack step without leaving it', async () => {
    server.use(http.post(`${BASE}/stock/5/consume/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderModal({ stock: serializedStock() })
    await user.click(screen.getByRole('button', { name: /consume 1/i }))
    await user.click(screen.getByTestId('pack-confirm'))
    expect(await screen.findByText(/could not consume/i)).toBeInTheDocument()
    expect(screen.getAllByTestId('pack-row')).toHaveLength(2)
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
  const mixedBatch = [
    { id: 30, quantity: 1, expiry_date: '2028-06-01', lot_number: 'LOT-S', serial_number: 'SN-1' },
    { id: 31, quantity: 1, expiry_date: '2028-06-01', lot_number: 'LOT-S', serial_number: 'SN-2' },
    { id: 32, quantity: 4, expiry_date: '2028-06-01', lot_number: 'LOT-S', serial_number: '' },
  ]

  it('sends what the routine flow would confirm for the same single unit', async () => {
    const stock = buildStock({ lots: mixedBatch })
    let receivedBody = null
    server.use(
      http.post(`${BASE}/stock/5/consume/`, async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )

    const picker = renderWithProviders(<LotPickerModal stock={stock} onClose={() => {}} onConsumed={() => {}} />)
    await picker.user.click(screen.getByRole('button', { name: /consume 1/i }))
    await picker.user.click(screen.getByText('SN-2'))
    await picker.user.click(screen.getByTestId('pack-confirm'))
    await waitFor(() => expect(receivedBody).not.toBeNull())
    picker.unmount()

    const onConfirm = vi.fn()
    const routine = renderWithProviders(
      <LotConsumeModal groups={lotsForSelection(stock)} needed={1} onConfirm={onConfirm} onCancel={() => {}} />,
    )
    await routine.user.click(screen.getByText('Confirm'))
    await routine.user.click(screen.getByText('SN-2'))
    await routine.user.click(screen.getByTestId('pack-confirm'))

    expect(onConfirm).toHaveBeenCalledWith([{ lot_id: 31, quantity: 1 }])
    expect(onConfirm).toHaveBeenCalledWith(receivedBody.lot_selections)
  })
})
