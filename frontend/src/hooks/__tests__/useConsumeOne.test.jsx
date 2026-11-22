import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, delay } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import LotPickerModal from '../../components/LotPickerModal'
import { list } from '../../offline/queue'
import { server } from '../../test/mocks/server'
import { flushQueueReads, renderWithProviders } from '../../test/helpers'
import { useConsumeOne } from '../useConsumeOne'

const BASE = '*/api'
const lot = (id, lot_number, expiry_date = '2099-01-01', quantity = 3) => ({ id, lot_number, expiry_date, quantity })
const oneLot = { id: 1, name: 'Filter', quantity: 3, quantity_available: 3, lots: [lot(10, 'A')] }
const twoLots = { ...oneLot, quantity: 6, lots: [lot(10, 'A'), lot(11, 'B', '2100-01-01')] }

function Harness({ stock, onConsumed }) {
  const { consumeOne, pickerStock, closePicker, onPickerConsumed } = useConsumeOne({ onConsumed })
  return (
    <>
      <button type="button" onClick={() => consumeOne(stock)}>
        go
      </button>
      {pickerStock && <LotPickerModal stock={stock} onClose={closePicker} onConsumed={onPickerConsumed} />}
    </>
  )
}

function setup(stock = oneLot) {
  const onConsumed = vi.fn()
  const view = renderWithProviders(<Harness stock={stock} onConsumed={onConsumed} />)
  return { ...view, onConsumed, go: () => view.user.click(screen.getByRole('button', { name: 'go' })) }
}

function captureConsume(response = { ...oneLot, consumption_id: 77 }) {
  const calls = []
  server.use(
    http.post(`${BASE}/stock/1/consume/`, async ({ request }) => {
      calls.push(await request.json())
      return HttpResponse.json(response)
    }),
  )
  return calls
}

describe('useConsumeOne', () => {
  it('refuses with no request when nothing is consumable', async () => {
    const calls = captureConsume()
    const { go } = setup({ ...oneLot, lots: [lot(10, 'A', '2020-01-01')] })
    await go()
    expect(await screen.findByText('Not enough stock (1 needed, 0 available).')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('with one lot consumes directly, leaving the order to the server', async () => {
    const calls = captureConsume()
    const { go } = setup()
    await go()
    await screen.findByText('1 unit of Filter consumed')
    expect(calls).toHaveLength(1)
    expect(calls[0].quantity).toBe(1)
    expect(calls[0].lot_selections).toBeUndefined()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reports each success to the caller', async () => {
    captureConsume()
    const { go, onConsumed } = setup()
    await go()
    await screen.findByText('1 unit of Filter consumed')
    expect(onConsumed).toHaveBeenCalledWith(oneLot)
  })

  it('offers no Undo when the response carries no consumption id', async () => {
    captureConsume(oneLot)
    const { go } = setup()
    await go()
    await screen.findByText('1 unit of Filter consumed')
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('Undo deletes the consumption it just made', async () => {
    captureConsume()
    let deleted = false
    server.use(
      http.delete(`${BASE}/stock-consumptions/77/`, () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { go, user } = setup()
    await go()
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(deleted).toBe(true))
  })

  it('a refused Undo says why', async () => {
    captureConsume()
    server.use(
      http.delete(`${BASE}/stock-consumptions/77/`, () =>
        HttpResponse.json({ detail: 'Only whoever made this consumption can undo it.' }, { status: 403 }),
      ),
    )
    const { go, user } = setup()
    await go()
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Only whoever made this consumption can undo it.')).toBeInTheDocument()
  })

  it('with several lots asks first and consumes nothing yet', async () => {
    const calls = captureConsume()
    const { go } = setup(twoLots)
    await go()
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('confirming the picker ends in the same toast with Undo', async () => {
    captureConsume()
    const { go, user } = setup(twoLots)
    await go()
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Consume 1' }))
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(screen.getAllByText('1 unit of Filter consumed')).toHaveLength(1)
  })

  it('queued offline: says so and offers no Undo', async () => {
    server.use(http.post(`${BASE}/stock/1/consume/`, () => HttpResponse.error()))
    const { go } = setup()
    await go()
    expect(await screen.findByText(/It will sync when you're back online/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    expect(await list()).toHaveLength(1)
    await flushQueueReads()
  })

  it('a server refusal shows its coded message', async () => {
    server.use(
      http.post(`${BASE}/stock/1/consume/`, () =>
        HttpResponse.json({ code: 'lot_expired', lot_ids: [10] }, { status: 422 }),
      ),
    )
    const { go } = setup()
    await go()
    expect(await screen.findByText(/expired/i)).toBeInTheDocument()
  })

  it('a double tap consumes once', async () => {
    let posts = 0
    server.use(
      http.post(`${BASE}/stock/1/consume/`, async () => {
        posts += 1
        await delay(30)
        return HttpResponse.json({ ...oneLot, consumption_id: 77 })
      }),
    )
    const { go } = setup()
    await Promise.all([go(), go()])
    await screen.findByText('1 unit of Filter consumed')
    expect(posts).toBe(1)
  })
})
