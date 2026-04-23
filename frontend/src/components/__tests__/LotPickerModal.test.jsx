import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
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
})
