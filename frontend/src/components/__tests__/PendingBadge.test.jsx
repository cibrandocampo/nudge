import 'fake-indexeddb/auto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enqueue, list } from '../../offline/queue'
import { __resetSyncWorkerForTests, initSyncWorker } from '../../offline/sync'
import { server } from '../../test/mocks/server'
import { flushQueueReads } from '../../test/helpers'
// Import the hook module so its `registerRollback('consumeStock', …)`
// side effect populates the registry before the discard tests run.
import '../../hooks/mutations/useConsumeStock'
import PendingBadge from '../PendingBadge'

/**
 * PendingBadge consumes `useQueryClient()` since T113 (the discard
 * button needs the live client to apply the rollback). Wrap every
 * render in a QueryClientProvider so that hook resolves; the helper
 * also returns the client so tests can pre-populate cache state.
 */
function renderBadge(options = {}) {
  const qc = options.qc ?? new QueryClient()
  const utils = render(
    <QueryClientProvider client={qc}>
      <PendingBadge />
    </QueryClientProvider>,
  )
  return { ...utils, qc }
}

const BASE = 'http://localhost/api'

function entry(overrides = {}) {
  return {
    id: 'k-1',
    method: 'POST',
    endpoint: '/routines/5/log/',
    body: {},
    resourceKey: 'routine:5',
    ifUnmodifiedSince: null,
    createdAt: '2026-04-17T08:00:00Z',
    status: 'pending',
    ...overrides,
  }
}

// The global setup empties the queue before each test and clears storage after
// it (src/test/setup.js). Clearing here after a test would change the queue
// under a still-mounted badge.
beforeEach(() => {
  __resetSyncWorkerForTests()
  localStorage.setItem('access_token', 'test-token')
})

afterEach(() => {
  __resetSyncWorkerForTests()
})

describe('PendingBadge', () => {
  it('renders nothing when the queue is empty', async () => {
    const { container } = renderBadge()
    await flushQueueReads()
    expect(container.firstChild).toBeNull()
  })

  it('shows the count when pending entries exist', async () => {
    await enqueue(entry({ id: 'a' }))
    await enqueue(entry({ id: 'b', createdAt: '2026-04-17T08:00:01Z' }))
    renderBadge()
    await waitFor(() => expect(screen.getByTestId('pending-badge')).toHaveTextContent('2'))
  })

  it('opens the panel on click and lists the entries', async () => {
    await enqueue(entry({ id: 'a' }))
    const user = userEvent.setup()
    renderBadge()
    await waitFor(() => screen.getByTestId('pending-badge'))
    await user.click(screen.getByTestId('pending-badge'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/POST \/routines\/5\/log\//)).toBeInTheDocument()
  })

  it('discards an entry via the panel button', async () => {
    await enqueue(entry({ id: 'a' }))
    const user = userEvent.setup()
    renderBadge()
    await waitFor(() => screen.getByTestId('pending-badge'))
    await user.click(screen.getByTestId('pending-badge'))
    await user.click(screen.getByRole('button', { name: /discard/i }))
    await waitFor(async () => expect(await list()).toHaveLength(0))
  })

  it('shows "!" when only errored entries remain, and retry all triggers a drain', async () => {
    let hits = 0
    server.use(
      http.post(`${BASE}/routines/5/log/`, () => {
        hits++
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )
    initSyncWorker({ invalidateQueries: async () => {} })
    await enqueue(entry({ id: 'err', status: 'error', errorMessage: 'HTTP 400' }))
    renderBadge()
    await waitFor(() => expect(screen.getByTestId('pending-badge')).toHaveTextContent('!'))
    const user = userEvent.setup()
    await user.click(screen.getByTestId('pending-badge'))
    await user.click(screen.getByRole('button', { name: /retry/i }))
    // forceSync resets error → pending and then drains; the entry should be
    // processed and the queue empty — so the badge goes away.
    await waitFor(() => expect(hits).toBe(1))
    await waitFor(() => expect(screen.queryByTestId('pending-badge')).not.toBeInTheDocument())
    expect(await list()).toEqual([])
  })

  it('reports the "syncing" dominant state when an entry is in flight', async () => {
    await enqueue(entry({ id: 'sync', status: 'syncing' }))
    renderBadge()
    await waitFor(() => expect(screen.getByTestId('pending-badge')).toHaveAttribute('data-state', 'syncing'))
  })

  it('opens the panel when the "open-pending-badge" event fires', async () => {
    await enqueue(entry({ id: 'a' }))
    renderBadge()
    await waitFor(() => screen.getByTestId('pending-badge'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new Event('open-pending-badge'))
    })
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
  })

  it('closes the panel via the close button in the panel header', async () => {
    await enqueue(entry({ id: 'a' }))
    const user = userEvent.setup()
    renderBadge()
    await waitFor(() => screen.getByTestId('pending-badge'))
    await user.click(screen.getByTestId('pending-badge'))
    await user.click(screen.getByRole('button', { name: /^close$/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes the panel on outside click', async () => {
    await enqueue(entry({ id: 'a' }))
    const user = userEvent.setup()
    renderBadge()
    await waitFor(() => screen.getByTestId('pending-badge'))
    await user.click(screen.getByTestId('pending-badge'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('renders the localized label when entry has labelKey + labelArgs (T108)', async () => {
    await enqueue(
      entry({
        id: 'lbl',
        labelKey: 'offline.label.consumeStock',
        labelArgs: { name: 'Vitamin D', qty: 1 },
      }),
    )
    const user = userEvent.setup()
    renderBadge()
    await waitFor(() => screen.getByTestId('pending-badge'))
    await user.click(screen.getByTestId('pending-badge'))
    expect(screen.getByText('Consume 1 of Vitamin D')).toBeInTheDocument()
    // The legacy "POST /endpoint" path must NOT show alongside the human label.
    expect(screen.queryByText(/POST \/routines\/5\/log\//)).not.toBeInTheDocument()
  })

  it('falls back to method + endpoint when labelKey is missing (T108)', async () => {
    await enqueue(entry({ id: 'fb', labelKey: null, labelArgs: null }))
    const user = userEvent.setup()
    renderBadge()
    await waitFor(() => screen.getByTestId('pending-badge'))
    await user.click(screen.getByTestId('pending-badge'))
    expect(screen.getByText('POST /routines/5/log/')).toBeInTheDocument()
  })

  // T109 — Cover the full set of label arg patterns the hooks emit. The
  // happy-path test above covers the `name` + `qty` pattern (consumeStock);
  // the three below cover `stockName` + `qty`, `username`, and no-args.
  it('renders a label with stockName + qty args (createStockLot pattern)', async () => {
    await enqueue(
      entry({
        id: 'lot',
        labelKey: 'offline.label.createStockLot',
        labelArgs: { stockName: 'Filters', qty: 5 },
      }),
    )
    const user = userEvent.setup()
    renderBadge()
    await waitFor(() => screen.getByTestId('pending-badge'))
    await user.click(screen.getByTestId('pending-badge'))
    expect(screen.getByText('Add lot (5 u.) to Filters')).toBeInTheDocument()
  })

  it('renders a label with a username arg (createContact pattern)', async () => {
    await enqueue(
      entry({
        id: 'contact',
        labelKey: 'offline.label.createContact',
        labelArgs: { username: 'alice' },
      }),
    )
    const user = userEvent.setup()
    renderBadge()
    await waitFor(() => screen.getByTestId('pending-badge'))
    await user.click(screen.getByTestId('pending-badge'))
    expect(screen.getByText('Add contact alice')).toBeInTheDocument()
  })

  it('renders a label with no args (changePassword pattern)', async () => {
    await enqueue(
      entry({
        id: 'pw',
        labelKey: 'offline.label.changePassword',
        labelArgs: {},
      }),
    )
    const user = userEvent.setup()
    renderBadge()
    await waitFor(() => screen.getByTestId('pending-badge'))
    await user.click(screen.getByTestId('pending-badge'))
    expect(screen.getByText('Change password')).toBeInTheDocument()
  })

  it('renders a label when labelKey is set but labelArgs is null', async () => {
    // Covers the `entry.labelArgs ?? {}` null-coalescing branch: when an entry
    // carries a labelKey but no labelArgs, the fallback empty object is used.
    await enqueue(
      entry({
        id: 'nullargs',
        labelKey: 'offline.label.changePassword',
        labelArgs: null,
      }),
    )
    const user = userEvent.setup()
    renderBadge()
    await waitFor(() => screen.getByTestId('pending-badge'))
    await user.click(screen.getByTestId('pending-badge'))
    expect(screen.getByText('Change password')).toBeInTheDocument()
  })

  it('clicking the warning icon on an error entry shows the error message', async () => {
    await enqueue(entry({ id: 'err', status: 'error', errorMessage: 'HTTP 401' }))
    const user = userEvent.setup()
    renderBadge()
    await waitFor(() => screen.getByTestId('pending-badge'))
    await user.click(screen.getByTestId('pending-badge'))
    expect(screen.queryByTestId('error-detail')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /show error details/i }))
    expect(screen.getByTestId('error-detail')).toHaveTextContent('HTTP 401')
  })

  it('clicking the warning icon again hides the error detail', async () => {
    await enqueue(entry({ id: 'err', status: 'error', errorMessage: 'HTTP 401' }))
    const user = userEvent.setup()
    renderBadge()
    await waitFor(() => screen.getByTestId('pending-badge'))
    await user.click(screen.getByTestId('pending-badge'))
    await user.click(screen.getByRole('button', { name: /show error details/i }))
    expect(screen.getByTestId('error-detail')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /show error details/i }))
    expect(screen.queryByTestId('error-detail')).not.toBeInTheDocument()
  })

  it('does not render error-detail when error entry has no errorMessage', async () => {
    await enqueue(entry({ id: 'err', status: 'error' }))
    const user = userEvent.setup()
    renderBadge()
    await waitFor(() => screen.getByTestId('pending-badge'))
    await user.click(screen.getByTestId('pending-badge'))
    await user.click(screen.getByRole('button', { name: /show error details/i }))
    expect(screen.queryByTestId('error-detail')).not.toBeInTheDocument()
  })

  it('translates an insufficient_stock refusal with the numbers the server sent', async () => {
    await enqueue(
      entry({
        id: 'err',
        status: 'error',
        errorMessage: 'insufficient_stock',
        errorArgs: { detail: 'Insufficient stock.', code: 'insufficient_stock', required: 3, available: 1 },
      }),
    )
    const user = userEvent.setup()
    renderBadge()
    await waitFor(() => screen.getByTestId('pending-badge'))
    await user.click(screen.getByTestId('pending-badge'))
    await user.click(screen.getByRole('button', { name: /show error details/i }))
    expect(screen.getByTestId('error-detail')).toHaveTextContent('Not enough stock (3 needed, 1 available).')
  })

  it('discarding a consume refused with insufficient_stock restores the cached stock', async () => {
    // The sync worker leaves an entry refused for good in `error`; the
    // optimistic decrement stays on screen until the user discards it.
    const qc = new QueryClient()
    qc.setQueryData(['stock', 1], {
      id: 1,
      name: 'Vit D',
      quantity: 0,
      lots: [],
    })
    qc.setQueryData(['stock'], [{ id: 1, name: 'Vit D', quantity: 0, lots: [] }])
    await enqueue(
      entry({
        id: 'consume-422',
        status: 'error',
        endpoint: '/stock/1/consume/',
        body: { quantity: 3 },
        resourceKey: 'stock:1',
        errorMessage: 'insufficient_stock',
        errorArgs: { code: 'insufficient_stock', required: 3, available: 1 },
        rollbackType: 'consumeStock',
        rollbackArgs: { stockId: 1, quantity: 3 },
      }),
    )

    const user = userEvent.setup()
    renderBadge({ qc })
    await waitFor(() => screen.getByTestId('pending-badge'))
    await user.click(screen.getByTestId('pending-badge'))
    await user.click(screen.getByRole('button', { name: /discard/i }))

    await waitFor(async () => expect(await list()).toHaveLength(0))
    expect(qc.getQueryData(['stock', 1]).quantity).toBe(3)
    expect(qc.getQueryData(['stock'])[0].quantity).toBe(3)
  })

  it('discard rolls back the optimistic before removing the entry (T113)', async () => {
    // End-to-end: an offline consume left the cache decremented (10 → 9)
    // and an entry with `rollbackType: 'consumeStock'` in the queue. Click
    // Discard from the panel — the registered inverse should re-increment
    // the cached quantity, and the queue entry should be gone.
    const qc = new QueryClient()
    qc.setQueryData(['stock', 1], {
      id: 1,
      name: 'Vit D',
      quantity: 9, // already decremented by the optimistic
      lots: [{ id: 100, quantity: 9, expiry_date: null, created_at: '2026-01-01T00:00:00Z' }],
    })
    qc.setQueryData(['stock'], [{ id: 1, name: 'Vit D', quantity: 9, lots: [{ id: 100, quantity: 9 }] }])
    await enqueue(
      entry({
        id: 'consume-1',
        method: 'POST',
        endpoint: '/stock/1/consume/',
        body: { quantity: 1, lot_selections: [{ lot_id: 100, quantity: 1 }] },
        resourceKey: 'stock:1',
        labelKey: 'offline.label.consumeStock',
        labelArgs: { name: 'Vit D', qty: 1 },
        rollbackType: 'consumeStock',
        rollbackArgs: { stockId: 1, quantity: 1, lotSelections: [{ lot_id: 100, quantity: 1 }] },
      }),
    )

    const user = userEvent.setup()
    renderBadge({ qc })
    await waitFor(() => screen.getByTestId('pending-badge'))
    await user.click(screen.getByTestId('pending-badge'))
    await user.click(screen.getByRole('button', { name: /discard/i }))

    await waitFor(async () => expect(await list()).toHaveLength(0))
    // Quantity restored to 10; the lot's quantity recovered too.
    expect(qc.getQueryData(['stock', 1]).quantity).toBe(10)
    expect(qc.getQueryData(['stock', 1]).lots[0].quantity).toBe(10)
    expect(qc.getQueryData(['stock'])[0].quantity).toBe(10)
  })
})
