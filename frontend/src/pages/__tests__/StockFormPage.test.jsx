import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import StockFormPage from '../StockFormPage'

const reachableRef = { current: true }
vi.mock('../../hooks/useServerReachable', () => ({
  useServerReachable: () => reachableRef.current,
}))

const BASE = 'http://localhost/api'

function renderCreate() {
  return renderWithProviders(
    <Routes>
      <Route path="/inventory/new" element={<StockFormPage />} />
      <Route path="/inventory/:id" element={<div>Detail stub</div>} />
    </Routes>,
    { initialEntries: ['/inventory/new'] },
  )
}

function renderEdit() {
  return renderWithProviders(
    <Routes>
      <Route path="/inventory/:id/edit" element={<StockFormPage />} />
      <Route path="/inventory/:id" element={<div>Detail stub</div>} />
    </Routes>,
    { initialEntries: ['/inventory/1/edit'] },
  )
}

const mockGroups = (groups = []) => server.use(http.get(`${BASE}/stock-groups/`, () => HttpResponse.json(groups)))
const mockContacts = (contacts = []) =>
  server.use(http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json(contacts)))
const mockStock = (stock) => server.use(http.get(`${BASE}/stock/${stock.id}/`, () => HttpResponse.json(stock)))

beforeEach(() => {
  reachableRef.current = true
})

describe('StockFormPage — create', () => {
  it('creates a stock with name only (no batches, no share)', async () => {
    let stockBody = null
    let lotCalls = 0
    server.use(
      http.post(`${BASE}/stock/`, async ({ request }) => {
        stockBody = await request.json()
        return HttpResponse.json(
          { id: 42, name: stockBody.name, group: null, shared_with: [], updated_at: '2026-04-22T10:00:00Z' },
          { status: 201 },
        )
      }),
      http.post(`${BASE}/stock/42/lots/`, () => ((lotCalls += 1), HttpResponse.json({}, { status: 201 }))),
    )
    mockGroups()
    mockContacts()

    const { user } = renderCreate()
    await user.type(screen.getByLabelText('Name'), 'Paracetamol')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(screen.getByText('Detail stub')).toBeInTheDocument())
    expect(stockBody).toEqual({ name: 'Paracetamol', group: null })
    expect(lotCalls).toBe(0)
  })

  it('creates a stock with N batches, firing one POST per batch', async () => {
    const lotBodies = []
    server.use(
      http.post(`${BASE}/stock/`, () =>
        HttpResponse.json(
          { id: 7, name: 'Ibuprofen', group: null, shared_with: [], updated_at: '2026-04-22T10:00:00Z' },
          { status: 201 },
        ),
      ),
      http.post(`${BASE}/stock/7/lots/`, async ({ request }) => {
        const body = await request.json()
        lotBodies.push(body)
        return HttpResponse.json({ id: 100 + lotBodies.length, ...body }, { status: 201 })
      }),
      http.get(`${BASE}/stock/7/`, () =>
        HttpResponse.json({ id: 7, name: 'Ibuprofen', lots: [], quantity: 0, updated_at: '2026-04-22T10:00:00Z' }),
      ),
    )
    mockGroups()
    mockContacts()

    const { user } = renderCreate()
    await user.type(screen.getByLabelText('Name'), 'Ibuprofen')
    // Add three batches.
    const addBatchBtn = screen.getByRole('button', { name: 'Add batch' })
    await user.click(addBatchBtn)
    await user.click(addBatchBtn)
    await user.click(addBatchBtn)
    const qtyInputs = screen.getAllByLabelText(/Batch \d+ quantity/)
    expect(qtyInputs).toHaveLength(3)
    await user.type(qtyInputs[0], '10')
    await user.type(qtyInputs[1], '5')
    await user.type(qtyInputs[2], '20')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(screen.getByText('Detail stub')).toBeInTheDocument())
    expect(lotBodies).toHaveLength(3)
    expect(lotBodies.map((b) => b.quantity)).toEqual([10, 5, 20])
  })

  it('allows removing a batch row before submit', async () => {
    const lotBodies = []
    server.use(
      http.post(`${BASE}/stock/`, () =>
        HttpResponse.json(
          { id: 8, name: 'X', group: null, shared_with: [], updated_at: '2026-04-22T10:00:00Z' },
          { status: 201 },
        ),
      ),
      http.post(`${BASE}/stock/8/lots/`, async ({ request }) => {
        const body = await request.json()
        lotBodies.push(body)
        return HttpResponse.json({ id: 1, ...body }, { status: 201 })
      }),
    )
    mockGroups()
    mockContacts()

    const { user } = renderCreate()
    await user.type(screen.getByLabelText('Name'), 'X')
    const addBatchBtn = screen.getByRole('button', { name: 'Add batch' })
    await user.click(addBatchBtn)
    await user.click(addBatchBtn)
    const qtyInputs = screen.getAllByLabelText(/Batch \d+ quantity/)
    await user.type(qtyInputs[0], '3')
    await user.type(qtyInputs[1], '9')
    // Remove the first row.
    await user.click(screen.getByRole('button', { name: /Remove batch 1/ }))
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(lotBodies).toHaveLength(1))
    expect(lotBodies[0].quantity).toBe(9)
  })

  it('blocks create when any batch has an invalid quantity', async () => {
    let stockCalls = 0
    server.use(http.post(`${BASE}/stock/`, () => ((stockCalls += 1), HttpResponse.json({ id: 1 }, { status: 201 }))))
    mockGroups()
    mockContacts()

    const { user } = renderCreate()
    await user.type(screen.getByLabelText('Name'), 'Bad')
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    const qtyInputs = screen.getAllByLabelText(/Batch \d+ quantity/)
    await user.type(qtyInputs[0], '5')
    // Second batch left empty → invalid.
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText(/positive quantity/i)).toBeInTheDocument()
    expect(stockCalls).toBe(0)
  })

  it('opens the ShareModal and syncs selected contacts into sharedWith', async () => {
    let sharedBody = null
    server.use(
      http.post(`${BASE}/stock/`, () =>
        HttpResponse.json(
          { id: 9, name: 'Water filters', group: null, shared_with: [], updated_at: '2026-04-22T10:00:00Z' },
          { status: 201 },
        ),
      ),
      http.patch(`${BASE}/stock/9/`, async ({ request }) => {
        sharedBody = await request.json()
        return HttpResponse.json({ id: 9, name: 'Water filters', group: null, shared_with: sharedBody.shared_with })
      }),
    )
    mockGroups()
    mockContacts([
      { id: 2, username: 'alice' },
      { id: 3, username: 'bob' },
    ])

    const { user } = renderCreate()
    await user.type(screen.getByLabelText('Name'), 'Water filters')
    await user.click(screen.getByRole('button', { name: /Share with/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByText('alice'))
    // Close the modal (click overlay).
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Chip for alice appears.
    expect(screen.getByText('alice')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(sharedBody).toEqual({ shared_with: [2] }))
  })

  it('removes a selected contact via the chip × button without reopening the modal', async () => {
    mockGroups()
    mockContacts([
      { id: 2, username: 'alice' },
      { id: 3, username: 'bob' },
    ])

    const { user } = renderCreate()
    await user.click(screen.getByRole('button', { name: /Share with/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByText('alice'))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Chip visible. Click its × to remove.
    await user.click(screen.getByRole('button', { name: /Unshare with alice/ }))
    expect(screen.queryByText('alice')).not.toBeInTheDocument()
  })
})

describe('StockFormPage — create error paths', () => {
  it('surfaces a generic error when the stock create responds without an id', async () => {
    server.use(http.post(`${BASE}/stock/`, () => HttpResponse.json({}, { status: 201 })))
    mockGroups()
    mockContacts()

    const { user } = renderCreate()
    await user.type(screen.getByLabelText('Name'), 'NoId')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    // Still on the form (no navigation) because we never got a valid id back.
    expect(screen.queryByText('Detail stub')).not.toBeInTheDocument()
  })

  it('shows a partial-failure toast when some batch POSTs reject', async () => {
    let lotCalls = 0
    server.use(
      http.post(`${BASE}/stock/`, () =>
        HttpResponse.json(
          { id: 12, name: 'Partial', group: null, shared_with: [], updated_at: '2026-04-22T10:00:00Z' },
          { status: 201 },
        ),
      ),
      http.post(`${BASE}/stock/12/lots/`, () => {
        lotCalls += 1
        if (lotCalls === 1) return new HttpResponse(null, { status: 500 })
        return HttpResponse.json({ id: 100 + lotCalls }, { status: 201 })
      }),
      http.get(`${BASE}/stock/12/`, () =>
        HttpResponse.json({ id: 12, name: 'Partial', lots: [], quantity: 0, updated_at: '2026-04-22T10:00:00Z' }),
      ),
    )
    mockGroups()
    mockContacts()

    const { user } = renderCreate()
    await user.type(screen.getByLabelText('Name'), 'Partial')
    const addBatchBtn = screen.getByRole('button', { name: 'Add batch' })
    await user.click(addBatchBtn)
    await user.click(addBatchBtn)
    const qtyInputs = screen.getAllByLabelText(/Batch \d+ quantity/)
    await user.type(qtyInputs[0], '3')
    await user.type(qtyInputs[1], '7')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    // Toast appears with the partial-failure copy. Still navigates (stock exists).
    expect(await screen.findByText(/1 batch.*could not be added/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Detail stub')).toBeInTheDocument())
  })

  it('still navigates after a failing shared_with PATCH (non-fatal)', async () => {
    let patchCalls = 0
    server.use(
      http.post(`${BASE}/stock/`, () =>
        HttpResponse.json(
          { id: 21, name: 'Share', group: null, shared_with: [], updated_at: '2026-04-22T10:00:00Z' },
          { status: 201 },
        ),
      ),
      http.patch(`${BASE}/stock/21/`, () => {
        patchCalls += 1
        return new HttpResponse(null, { status: 500 })
      }),
    )
    mockGroups()
    mockContacts([{ id: 2, username: 'alice' }])

    const { user } = renderCreate()
    await user.type(screen.getByLabelText('Name'), 'Share')
    await user.click(screen.getByRole('button', { name: /Share with/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByText('alice'))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(screen.getByText('Detail stub')).toBeInTheDocument())
    expect(patchCalls).toBe(1)
  })
})

describe('StockFormPage — batch uid fallback', () => {
  // `newBatchUid` falls back to a counter+timestamp when `crypto.randomUUID`
  // is unavailable. Production hits this path on plain-HTTP LAN deploys and
  // on `host.docker.internal` in e2e, where secure-context crypto is off.
  let originalRandomUUID
  beforeEach(() => {
    originalRandomUUID = globalThis.crypto?.randomUUID
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      writable: true,
      value: undefined,
    })
  })
  afterEach(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      writable: true,
      value: originalRandomUUID,
    })
  })

  it('still generates distinct batch row keys when crypto.randomUUID is unavailable', async () => {
    mockGroups()
    mockContacts()

    const { user } = renderCreate()
    const addBatchBtn = screen.getByRole('button', { name: 'Add batch' })
    // Two batches → two invocations of the fallback uid generator. If it
    // returned the same value React would warn about duplicate keys and the
    // second <input> would share state with the first.
    await user.click(addBatchBtn)
    await user.click(addBatchBtn)
    const qtyInputs = screen.getAllByLabelText(/Batch \d+ quantity/)
    expect(qtyInputs).toHaveLength(2)
    await user.type(qtyInputs[0], '1')
    await user.type(qtyInputs[1], '2')
    expect(qtyInputs[0]).toHaveValue(1)
    expect(qtyInputs[1]).toHaveValue(2)
  })
})

describe('StockFormPage — edit', () => {
  it('prefills the form and PATCHes on submit without showing the batches section', async () => {
    mockStock({
      id: 1,
      name: 'Vitamin D',
      group: 5,
      shared_with: [],
      updated_at: '2026-04-22T10:00:00Z',
    })
    mockGroups([{ id: 5, name: 'Supplements', display_order: 0 }])
    mockContacts()
    let patchBody = null
    server.use(
      http.patch(`${BASE}/stock/1/`, async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({ id: 1, ...patchBody })
      }),
    )

    const { user } = renderEdit()
    const nameInput = await screen.findByDisplayValue('Vitamin D')
    // Batches section is create-only.
    expect(screen.queryByRole('button', { name: 'Add batch' })).not.toBeInTheDocument()
    await user.clear(nameInput)
    await user.type(nameInput, 'Vitamin D3')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByText('Detail stub')).toBeInTheDocument())
    expect(patchBody).toEqual({ name: 'Vitamin D3', group: 5, shared_with: [] })
  })

  it('surfaces a generic error when the PATCH returns 412', async () => {
    mockStock({ id: 1, name: 'Vitamin D', group: null, shared_with: [], updated_at: '2026-04-22T10:00:00Z' })
    mockGroups()
    mockContacts()
    server.use(
      http.patch(`${BASE}/stock/1/`, () =>
        HttpResponse.json(
          { error: 'conflict', current: { id: 1, name: 'X', updated_at: '2026-04-22T11:00:00Z' } },
          { status: 412 },
        ),
      ),
    )

    const { user } = renderEdit()
    const nameInput = await screen.findByDisplayValue('Vitamin D')
    await user.clear(nameInput)
    await user.type(nameInput, 'Vitamin D3')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
  })
})
