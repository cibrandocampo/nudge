import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, vi } from 'vitest'
import { clear, list } from '../../offline/queue'
import { mockNetworkError } from '../../test/mocks/handlers'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import StockDetailPage from '../StockDetailPage'

const reachableRef = { current: true }
vi.mock('../../hooks/useServerReachable', () => ({
  useServerReachable: () => reachableRef.current,
}))

const scannerAvailableRef = { current: true }
vi.mock('../../hooks/useScannerAvailable', () => ({
  useScannerAvailable: () => scannerAvailableRef.current,
}))

// Stub for the camera modal: jsdom has no camera and no WebAssembly decoder,
// so the payload is injected instead. It honours the real contract — a read
// the page rejects (`false`) leaves the scanner open — so the "stays open"
// test means something.
const payloadRef = { current: '' }
vi.mock('../../components/BarcodeScannerModal', () => ({
  default: ({ onDecoded, onClose, notice }) => (
    <div data-testid="scanner">
      {notice && <span data-testid="scan-notice">{notice}</span>}
      <button
        type="button"
        data-testid="stub-decode"
        onClick={() => {
          if (onDecoded(payloadRef.current) !== false) onClose()
        }}
      >
        decode
      </button>
    </div>
  ),
}))

const BASE = 'http://localhost/api'

// Lot expiry severity is `today`-relative (see utils/stockSeverity.js), so any
// literal future date in the fixtures decays the moment the calendar crosses
// it. Anchor "soon" and "far" fixtures off the current date instead.
function daysFromNow(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

const stock = {
  id: 1,
  name: 'Water filter',
  quantity: 10,
  group: null,
  estimated_depletion_date: null,
  daily_consumption_own: null,
  daily_consumption_shared: null,
  stock_severity: 'ok',
  expiry_severity: 'ok',
  is_owner: true,
  owner_display_name: 'testuser',
  shared_with: [],
  shared_with_details: [],
  updated_at: '2026-04-17T10:00:00Z',
  lots: [
    { id: 100, quantity: 5, expiry_date: daysFromNow(60), lot_number: 'LOT-A', updated_at: '2026-04-17T10:00:00Z' },
    { id: 101, quantity: 5, expiry_date: null, lot_number: '', updated_at: '2026-04-17T10:00:00Z' },
  ],
}

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/inventory/:id" element={<StockDetailPage />} />
      <Route path="/inventory/:id/edit" element={<div>Edit form stub</div>} />
      <Route path="/inventory" element={<div>Inventory home</div>} />
    </Routes>,
    { initialEntries: ['/inventory/1'] },
  )
}

describe('StockDetailPage', () => {
  beforeEach(() => {
    reachableRef.current = true
    scannerAvailableRef.current = true
    payloadRef.current = ''
    server.use(
      http.get(`${BASE}/stock/1/`, () => HttpResponse.json(stock)),
      http.get(`${BASE}/stock-consumptions/`, () => HttpResponse.json({ results: [] })),
      http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: [] })),
    )
  })

  it('shows spinner while loading', () => {
    renderDetail()
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
  })

  it('renders the stock name, quantity and lots', async () => {
    renderDetail()
    expect(await screen.findByText('Water filter')).toBeInTheDocument()
    expect(screen.getByText(/10 total/)).toBeInTheDocument()
    expect(screen.getByText('LOT-A')).toBeInTheDocument()
  })

  it('shows not-found message when the API returns 404', async () => {
    server.use(http.get(`${BASE}/stock/1/`, () => new HttpResponse(null, { status: 404 })))
    renderDetail()
    await waitFor(() => expect(screen.getByText(/Stock not found/)).toBeInTheDocument())
  })

  it('renders the stock name as static text, not as an editable input', async () => {
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    // Clicking the name must NOT turn it into an input (inline edit retired).
    await user.click(screen.getByText('Water filter'))
    expect(screen.queryByDisplayValue('Water filter')).not.toBeInTheDocument()
  })

  it('navigates to /inventory/:id/edit when the Edit button is clicked', async () => {
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('Edit form stub')).toBeInTheDocument()
  })

  it('marks the Edit button as aria-disabled when offline', async () => {
    reachableRef.current = false
    renderDetail()
    await screen.findByText('Water filter')
    const btn = screen.getByRole('button', { name: 'Edit' })
    // Not `disabled`: the click handler still fires, surfacing a toast
    // ``offline.pageUnavailable`` instead of silently swallowing the click.
    expect(btn).toHaveAttribute('aria-disabled', 'true')
    expect(btn).toHaveAttribute('title', 'This section is not available offline.')
  })

  it('offline: clicking Edit / Delete stock / Add lot / Delete lot surfaces the offline toast', async () => {
    // Single integration-style test that exercises the four offline
    // click-handler branches in one render. Keeping them together lets
    // us assert the toast text once per branch without spinning four
    // separate provider trees.
    reachableRef.current = false
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    let priorToastCount = 0
    const expectNewToast = async () => {
      // Toasts stack until auto-dismiss, so each click adds one. Assert
      // the count grew by at least one (`findAllByText` retries) rather
      // than fishing for a single element.
      const toasts = await screen.findAllByText(/not available offline/i)
      expect(toasts.length).toBeGreaterThan(priorToastCount)
      priorToastCount = toasts.length
    }

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await expectNewToast()

    await user.click(screen.getByRole('button', { name: 'Delete stock' }))
    await expectNewToast()

    await user.click(screen.getByTestId('add-lot-toggle'))
    await expectNewToast()

    // The first "Delete"-named button is the topbar "Delete stock"; the
    // last one is the per-lot trash. Pick the last to avoid ambiguity.
    const lotDeletes = screen.getAllByRole('button', { name: /Delete/, exact: false })
    await user.click(lotDeletes[lotDeletes.length - 1])
    await expectNewToast()
  })

  it('keeps the Edit button visible for non-owners (recipients edit their group there) but hides Delete', async () => {
    server.use(
      http.get(`${BASE}/stock/1/`, () => HttpResponse.json({ ...stock, is_owner: false, owner_display_name: 'alice' })),
    )
    renderDetail()
    await screen.findByText('Water filter')
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete stock' })).not.toBeInTheDocument()
  })

  it('ignores add-lot submission with an invalid quantity', async () => {
    const postSpy = vi.fn()
    server.use(
      http.post(`${BASE}/stock/1/lots/`, () => {
        postSpy()
        return new HttpResponse(null, { status: 201 })
      }),
    )
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('add-lot-toggle'))
    // Typing only '-' keeps qty as empty string in the number input, which
    // parseInt turns into NaN and the handler short-circuits.
    const qtyInput = screen.getByPlaceholderText('0')
    await user.type(qtyInput, '-')
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    expect(postSpy).not.toHaveBeenCalled()
  })

  it('adds a lot via the form when the inputs are valid', async () => {
    let postBody = null
    server.use(
      http.post(`${BASE}/stock/1/lots/`, async ({ request }) => {
        postBody = await request.json()
        return HttpResponse.json({ id: 200, ...postBody }, { status: 201 })
      }),
    )
    const { user, container } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('add-lot-toggle'))
    await user.click(screen.getByTestId('more-fields'))
    await user.type(screen.getByPlaceholderText('0'), '7')
    const dateInput = container.querySelector('input[type="date"]')
    await user.type(dateInput, '2027-12-31')
    await user.type(screen.getByPlaceholderText('Batch ID (optional)'), 'FILT-Z')
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    await waitFor(() => expect(postBody?.quantity).toBe(7))
    expect(postBody.lot_number).toBe('FILT-Z')
  })

  it('suggests existing lot numbers and fills the input on selection', async () => {
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('add-lot-toggle'))
    await user.click(screen.getByTestId('more-fields'))
    const lotInput = screen.getByPlaceholderText('Batch ID (optional)')
    await user.click(lotInput)
    // The option now reads "LOT-A · <expiry>" — the date rides along so the
    // autofill is visibly sourced — so match the number rather than the whole
    // accessible name.
    const suggestion = await screen.findByRole('option', { name: /LOT-A/ })
    await user.click(suggestion)
    expect(lotInput).toHaveValue('LOT-A')
    expect(screen.queryByRole('option', { name: /LOT-A/ })).not.toBeInTheDocument()
  })

  it('deletes a lot through the confirm modal', async () => {
    let deleteCalled = false
    server.use(
      http.delete(`${BASE}/stock/1/lots/100/`, () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    const lotDeleteBtns = screen.getAllByTitle('Delete')
    await user.click(lotDeleteBtns[0])
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteCalled).toBe(true))
  })

  it('deletes the stock and navigates back to /inventory', async () => {
    let deleteCalled = false
    server.use(
      http.delete(`${BASE}/stock/1/`, () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByRole('button', { name: /Delete stock/ }))
    const dialog = screen.getByRole('dialog')
    // Confirm inside the dialog
    const confirmBtn = dialog.querySelectorAll('button')[1]
    await user.click(confirmBtn)
    await waitFor(() => expect(deleteCalled).toBe(true))
    await waitFor(() => expect(screen.getByText('Inventory home')).toBeInTheDocument())
  })

  it('shows error toast when delete stock fails with a server error', async () => {
    server.use(http.delete(`${BASE}/stock/1/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByRole('button', { name: /Delete stock/ }))
    const dialog = screen.getByRole('dialog')
    const confirmBtn = dialog.querySelectorAll('button')[1]
    await user.click(confirmBtn)
    await waitFor(() => expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument())
  })

  it('queues delete stock offline when the DELETE hits a network error', async () => {
    await clear()
    server.use(mockNetworkError('delete', '/stock/1/'))
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByRole('button', { name: /Delete stock/ }))
    const dialog = screen.getByRole('dialog')
    const confirmBtn = dialog.querySelectorAll('button')[1]
    await user.click(confirmBtn)
    await waitFor(async () => expect(await list()).toHaveLength(1))
    await clear()
  })

  it('renders depletion date and low-stock markup when present', async () => {
    const lowStock = {
      ...stock,
      estimated_depletion_date: '2026-05-06',
      daily_consumption_own: 2.5,
      stock_severity: 'low',
      quantity: 2,
    }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(lowStock)))
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('depletion-date')).toBeInTheDocument())
    const depletion = screen.getByTestId('depletion-date')
    expect(depletion.className).toMatch(/stockDepletionWarn/)
  })

  it('paints the depletion date red when stock_severity is "critical"', async () => {
    const empty = {
      ...stock,
      quantity: 0,
      quantity_available: 0,
      stock_severity: 'critical',
      estimated_depletion_date: '2026-04-27',
      lots: [],
    }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(empty)))
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('depletion-date')).toBeInTheDocument())
    const depletion = screen.getByTestId('depletion-date')
    expect(depletion.className).toMatch(/stockDepletionDanger/)
  })

  it('shows an owner chip when the stock is shared with the current user', async () => {
    const sharedStock = { ...stock, is_owner: false, owner_display_name: 'alice' }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(sharedStock)))
    renderDetail()
    const section = await screen.findByTestId('owner-info')
    expect(section).toBeInTheDocument()
    expect(section).toHaveTextContent('Owner')
    expect(section).toHaveTextContent('alice')
    // Avatar initial rendered inside the chip
    expect(section).toHaveTextContent('A')
  })

  it('keeps the owner chip in its own section, separate from other recipients', async () => {
    // Owner is singular by definition. The "Propietario" section must
    // contain ONLY the owner; other recipients move to the sibling
    // "Shared with" section. Pre-fix the recipient case mashed both
    // under the same misleading title.
    const sharedStock = {
      ...stock,
      is_owner: false,
      owner_display_name: 'alice',
      shared_with_details: [
        // id=1 matches the viewer; id=4 is bob — only bob should appear in
        // the "Shared with" section.
        { id: 1, first_name: '', last_name: '', email: 'testuser@example.com' },
        { id: 4, first_name: 'Bob', last_name: '', email: 'bob@example.com' },
      ],
    }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(sharedStock)))
    renderDetail()
    const ownerSection = await screen.findByTestId('owner-info')
    expect(ownerSection).toHaveTextContent('alice')
    expect(ownerSection).not.toHaveTextContent('Bob')
    const sharedSection = screen.getByTestId('shared-with-info')
    expect(sharedSection).toHaveTextContent('Bob')
    expect(sharedSection).not.toHaveTextContent('alice')
  })

  it('hides the "Shared with" section when the current user is the sole recipient', async () => {
    // No "other" recipients besides the viewer → the Shared-with section
    // would be empty, so it does not render at all. The owner chip stays.
    const sharedStock = {
      ...stock,
      is_owner: false,
      owner_display_name: 'alice',
      // id matches `defaultAuth.user.id` (= 1) → filtered out as "me".
      shared_with_details: [{ id: 1, first_name: '', last_name: '', email: 'testuser@example.com' }],
    }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(sharedStock)))
    renderDetail()
    const ownerSection = await screen.findByTestId('owner-info')
    expect(ownerSection).toHaveTextContent('alice')
    expect(screen.queryByTestId('shared-with-info')).not.toBeInTheDocument()
  })

  it('renders the danger border when stock_severity is "critical"', async () => {
    const empty = { ...stock, quantity: 0, quantity_available: 0, stock_severity: 'critical', lots: [] }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(empty)))
    const { container } = renderDetail()
    await screen.findByText('Water filter')
    expect(container.querySelector('[class*="cardBorderDanger"]')).toBeInTheDocument()
  })

  it('renders the group name when the stock belongs to a group', async () => {
    const groupedStock = { ...stock, group: 1 }
    server.use(
      http.get(`${BASE}/stock/1/`, () => HttpResponse.json(groupedStock)),
      http.get(`${BASE}/stock-groups/`, () =>
        HttpResponse.json({ results: [{ id: 1, name: 'Household', display_order: 0 }] }),
      ),
    )
    renderDetail()
    await waitFor(() => expect(screen.getByText('Household')).toBeInTheDocument())
  })

  it('falls back to the owner group when no personal override exists (T176)', async () => {
    // ``my_group`` is null → frontend reads ``group`` (the owner's). The
    // group label rendered must match the owner's group name. Pins the
    // T176 fallback behaviour against regressions in `effectiveGroupId`.
    const sharedStock = { ...stock, group: 1, my_group: null, my_group_name: null, is_owner: false }
    server.use(
      http.get(`${BASE}/stock/1/`, () => HttpResponse.json(sharedStock)),
      http.get(`${BASE}/stock-groups/`, () =>
        HttpResponse.json({ results: [{ id: 1, name: 'Owner Group', display_order: 0 }] }),
      ),
    )
    renderDetail()
    await waitFor(() => expect(screen.getByText('Owner Group')).toBeInTheDocument())
  })

  it('shows the personal override over the owner group when present (T176)', async () => {
    // ``my_group`` is set → frontend prefers it over ``group``. The label
    // shown is the override's name, not the owner's. Pairs with the
    // fallback test above to lock in the ``my_group ?? group`` rule.
    const sharedStock = {
      ...stock,
      group: 1,
      my_group: 2,
      my_group_name: 'My Override',
      is_owner: false,
    }
    server.use(
      http.get(`${BASE}/stock/1/`, () => HttpResponse.json(sharedStock)),
      http.get(`${BASE}/stock-groups/`, () =>
        HttpResponse.json({
          results: [
            { id: 1, name: 'Owner Group', display_order: 0 },
            { id: 2, name: 'My Override', display_order: 1 },
          ],
        }),
      ),
    )
    renderDetail()
    await waitFor(() => expect(screen.getByText('My Override')).toBeInTheDocument())
    expect(screen.queryByText('Owner Group')).not.toBeInTheDocument()
  })

  it('shows generic error state when the API fails with a non-404 status', async () => {
    server.use(http.get(`${BASE}/stock/1/`, () => new HttpResponse(null, { status: 500 })))
    renderDetail()
    await waitFor(() => expect(screen.getByText(/Could not load data/)).toBeInTheDocument())
  })

  it('shows error toast when add-lot fails with a server error', async () => {
    server.use(http.post(`${BASE}/stock/1/lots/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('add-lot-toggle'))
    await user.type(screen.getByPlaceholderText('0'), '3')
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    await waitFor(() => expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument())
  })

  it('shows error toast when delete lot fails with a server error', async () => {
    server.use(http.delete(`${BASE}/stock/1/lots/100/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    const lotDeleteBtns = screen.getAllByTitle('Delete')
    await user.click(lotDeleteBtns[0])
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument())
  })

  it('renders recent consumption rows when the API returns entries', async () => {
    server.use(
      http.get(`${BASE}/stock-consumptions/`, () =>
        HttpResponse.json({
          results: [
            {
              id: 1,
              quantity: 2,
              created_at: '2026-04-15T10:00:00Z',
              consumed_by_id: 99,
              consumed_by_display_name: 'Alice',
            },
            {
              id: 2,
              quantity: 1,
              created_at: '2026-04-10T10:00:00Z',
              consumed_by_id: null,
              consumed_by_display_name: null,
            },
          ],
        }),
      ),
    )
    renderDetail()
    await waitFor(() => expect(screen.getByText(/Recent consumption/)).toBeInTheDocument())
    // The chip renders an icon + the bare display name; the localised
    // "by …" string lives on the aria-label / title for accessibility.
    expect(screen.getByLabelText(/by Alice/)).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  // Lot highlight tri-state — derived in-page from each lot.expiry_date
  // via `lotExpirySeverity`. Today's clock is 2026-04-27 in the test
  // environment (matched by the hardcoded fixture dates below).
  it('marks a lot expired in the past as data-expiring="reached"', async () => {
    const past = {
      ...stock,
      lots: [{ id: 200, quantity: 3, expiry_date: '2026-04-20', lot_number: 'OLD' }],
    }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(past)))
    renderDetail()
    const row = await screen.findByTestId('lot-row')
    expect(row).toHaveAttribute('data-expiring', 'reached')
  })

  it('marks a lot expiring within 30 days as data-expiring="soon"', async () => {
    const soon = {
      ...stock,
      lots: [{ id: 200, quantity: 3, expiry_date: daysFromNow(15), lot_number: 'NEXT' }],
    }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(soon)))
    renderDetail()
    const row = await screen.findByTestId('lot-row')
    expect(row).toHaveAttribute('data-expiring', 'soon')
  })

  it('leaves a far-future lot as data-expiring="none"', async () => {
    const far = {
      ...stock,
      lots: [{ id: 200, quantity: 3, expiry_date: daysFromNow(60), lot_number: 'FAR' }],
    }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(far)))
    renderDetail()
    const row = await screen.findByTestId('lot-row')
    expect(row).toHaveAttribute('data-expiring', 'none')
  })

  it('leaves a lot without expiry_date as data-expiring="none"', async () => {
    const unbounded = {
      ...stock,
      lots: [{ id: 200, quantity: 3, expiry_date: null, lot_number: '' }],
    }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(unbounded)))
    renderDetail()
    const row = await screen.findByTestId('lot-row')
    expect(row).toHaveAttribute('data-expiring', 'none')
  })

  // T167: stock-only border (no worst-of-two). The expiry signal lives on
  // per-lot indicators only — see iconClassForLot tests below.
  it('paints the header card border warning when stock_severity is "low"', async () => {
    const lowStock = { ...stock, stock_severity: 'low' }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(lowStock)))
    const { container } = renderDetail()
    await screen.findByText('Water filter')
    const card = container.querySelector('.card')
    expect(card.getAttribute('class') ?? '').toContain('cardBorderWarning')
  })

  it('paints the header card border success when stock_severity is "ok"', async () => {
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(stock)))
    const { container } = renderDetail()
    await screen.findByText('Water filter')
    const card = container.querySelector('.card')
    expect(card.getAttribute('class') ?? '').toContain('cardBorderSuccess')
  })

  // T167: header rendering — quantity_available + (N expired) suffix.
  it('header shows quantity_available with (N expired) suffix when there are expired lots', async () => {
    const withExpired = {
      ...stock,
      quantity: 18,
      quantity_available: 13,
      quantity_expired: 5,
    }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(withExpired)))
    const { container } = renderDetail()
    await screen.findByText('Water filter')
    // The qty span renders quantity_available (13), not the total (18).
    const qty = container.querySelector('[class*="stockQty"]:not([class*="stockQtyExpired"])')
    expect(qty.textContent).toMatch(/13/)
    expect(qty.textContent).not.toMatch(/18/)
    // The expired suffix span renders "(5 expired)".
    const expiredSuffix = container.querySelector('[class*="stockQtyExpired"]')
    expect(expiredSuffix).not.toBeNull()
    expect(expiredSuffix.textContent).toMatch(/5 expired/)
  })

  it('header omits the expired suffix when quantity_expired is 0', async () => {
    const noExpired = { ...stock, quantity_available: 10, quantity_expired: 0 }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(noExpired)))
    const { container } = renderDetail()
    await screen.findByText('Water filter')
    expect(container.querySelector('[class*="stockQtyExpired"]')).toBeNull()
  })

  // T167: per-lot expiry date tint + line-through on expired lot qty.
  it('tints the lot expiry date span for a soon-expiring lot', async () => {
    const soonLot = {
      ...stock,
      lots: [{ id: 200, quantity: 3, expiry_date: daysFromNow(15), lot_number: 'NEXT' }],
    }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(soonLot)))
    renderDetail()
    const row = await screen.findByTestId('lot-row')
    const dateSpan = row.querySelector('[class*="cardLotExpiry"]')
    expect(dateSpan).not.toBeNull()
    expect(dateSpan.getAttribute('class')).toContain('iconWarning')
  })

  it('applies line-through to the qty span of an expired (reached) lot', async () => {
    const past = {
      ...stock,
      lots: [{ id: 200, quantity: 3, expiry_date: '2026-04-20', lot_number: 'OLD' }],
    }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(past)))
    renderDetail()
    const row = await screen.findByTestId('lot-row')
    const qtySpan = row.querySelector('[class*="cardLotQty"]')
    expect(qtySpan).not.toBeNull()
    expect(qtySpan.getAttribute('class')).toContain('cardLotQtyExpired')
  })

  // Per-lot icon tint — derived from each lot.expiry_date (mirrors the
  // data-expiring attribute). The package icon is the first <svg> inside
  // the lot row; we walk via its <use href="#i-package"> to be unambiguous.
  it('tints the package icon iconDanger for a lot in the past', async () => {
    const past = {
      ...stock,
      lots: [{ id: 200, quantity: 3, expiry_date: '2026-04-20', lot_number: 'OLD' }],
    }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(past)))
    renderDetail()
    const row = await screen.findByTestId('lot-row')
    const svg = row.querySelector('svg use[href="#i-package"]').parentElement
    expect(svg.getAttribute('class') ?? '').toContain('iconDanger')
  })

  it('tints the package icon iconWarning for a lot expiring within 30 days', async () => {
    const soonLot = {
      ...stock,
      lots: [{ id: 200, quantity: 3, expiry_date: daysFromNow(15), lot_number: 'NEXT' }],
    }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(soonLot)))
    renderDetail()
    const row = await screen.findByTestId('lot-row')
    const svg = row.querySelector('svg use[href="#i-package"]').parentElement
    expect(svg.getAttribute('class') ?? '').toContain('iconWarning')
  })

  it('leaves the package icon untinted for a far-future lot', async () => {
    const far = {
      ...stock,
      lots: [{ id: 200, quantity: 3, expiry_date: daysFromNow(60), lot_number: 'FAR' }],
    }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(far)))
    renderDetail()
    const row = await screen.findByTestId('lot-row')
    const svg = row.querySelector('svg use[href="#i-package"]').parentElement
    const cls = svg.getAttribute('class') ?? ''
    expect(cls).not.toContain('iconDanger')
    expect(cls).not.toContain('iconWarning')
  })

  it('renders the shared-with chips when the owner has shared the stock', async () => {
    const ownedShared = {
      ...stock,
      shared_with_details: [{ id: 20, first_name: 'Bob', last_name: 'Smith', email: 'bob@example.com' }],
    }
    server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(ownedShared)))
    renderDetail()
    const block = await screen.findByTestId('shared-with-info')
    expect(within(block).getByText('Shared with')).toBeInTheDocument()
    // Post-T197: read-only chips render the display label (fullName).
    expect(within(block).getByText('Bob Smith')).toBeInTheDocument()
  })

  // ── Grouped lot list (T027) ───────────────────────────────────────────────

  const serializedStock = (overrides = {}) => ({
    ...stock,
    lots: [
      {
        id: 200,
        quantity: 1,
        expiry_date: daysFromNow(120),
        lot_number: 'LOT-S',
        serial_number: 'SN-1',
        created_at: '2026-04-17T10:00:00Z',
        updated_at: '2026-04-17T10:00:00Z',
      },
      {
        id: 201,
        quantity: 1,
        expiry_date: daysFromNow(120),
        lot_number: 'LOT-S',
        serial_number: 'SN-2',
        created_at: '2026-04-17T11:00:00Z',
        updated_at: '2026-04-17T11:00:00Z',
      },
    ],
    ...overrides,
  })

  const useStockResponse = (payload) => server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json(payload)))

  it('collapses lots sharing lot number and expiry into one row with the summed quantity', async () => {
    useStockResponse(serializedStock())
    renderDetail()
    await screen.findByText('Water filter')

    const rows = screen.getAllByTestId('lot-row')
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText(/2 u/)).toBeInTheDocument()
    // The box count lives on the expander, not as a caption in the lot pill.
    expect(within(within(rows[0]).getByTestId('group-expander')).getByText('2')).toBeInTheDocument()
  })

  it('expands a group to show each box by its serial', async () => {
    useStockResponse(serializedStock())
    const { user } = renderDetail()
    await screen.findByText('Water filter')

    expect(screen.queryByTestId('pack-row')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('group-expander'))

    const packs = screen.getAllByTestId('pack-row')
    expect(packs).toHaveLength(2)
    // The expanded rows list packs, so the serial stands alone — no prefix.
    expect(screen.getByText('SN-1')).toBeInTheDocument()
    expect(screen.getByText('SN-2')).toBeInTheDocument()
  })

  it('deletes the box the user picked, not the first of the group', async () => {
    let deletedId = null
    useStockResponse(serializedStock())
    server.use(
      http.delete(`${BASE}/stock/1/lots/:lotId/`, ({ params }) => {
        deletedId = params.lotId
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('group-expander'))

    const secondPack = screen.getAllByTestId('pack-row')[1]
    await user.click(within(secondPack).getByLabelText('Delete'))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deletedId).toBe('201'))
  })

  it('names the pack in the delete confirmation', async () => {
    useStockResponse(serializedStock())
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('group-expander'))

    const firstPack = screen.getAllByTestId('pack-row')[0]
    await user.click(within(firstPack).getByLabelText('Delete'))
    // Scoped to the dialog: the pack row on the page also mentions the serial.
    expect(within(screen.getByRole('dialog')).getByText(/serial SN-1/i)).toBeInTheDocument()
  })

  it('keeps lots with the same lot number but different expiry as separate rows', async () => {
    useStockResponse(
      serializedStock({
        lots: [
          { id: 300, quantity: 1, expiry_date: daysFromNow(60), lot_number: 'LOT-X', updated_at: 'x' },
          { id: 301, quantity: 1, expiry_date: daysFromNow(120), lot_number: 'LOT-X', updated_at: 'x' },
        ],
      }),
    )
    renderDetail()
    await screen.findByText('Water filter')

    expect(screen.getAllByTestId('lot-row')).toHaveLength(2)
    expect(screen.queryByTestId('group-expander')).not.toBeInTheDocument()
  })

  it('renders a single unserialized lot exactly as before, with its own delete button', async () => {
    renderDetail()
    await screen.findByText('Water filter')

    // The default fixture has two distinct lots, neither grouped nor split.
    expect(screen.getAllByTestId('lot-row')).toHaveLength(2)
    expect(screen.queryByTestId('group-expander')).not.toBeInTheDocument()
    expect(screen.getAllByLabelText('Delete')).toHaveLength(2)
  })

  // ── Consume one unit from the header card ────────────────────────────────

  it('offers a consume button on the stock card', async () => {
    renderDetail()
    await screen.findByText('Water filter')

    expect(screen.getByTestId('consume-one')).toBeInTheDocument()
  })

  it('hides the consume button when there is nothing left to consume', async () => {
    // A button that could only fail is worse than no button.
    server.use(
      http.get(`${BASE}/stock/1/`, () => HttpResponse.json({ ...stock, quantity: 0, quantity_available: 0, lots: [] })),
    )
    renderDetail()
    await screen.findByText('Water filter')

    expect(screen.queryByTestId('consume-one')).not.toBeInTheDocument()
  })

  it('opens the pack picker instead of consuming blindly', async () => {
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('consume-one'))

    // LotPickerModal asks which lot first — the fixture has two. Scope the
    // lookup to the dialog: "LOT-A" also labels a row in the page behind it.
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('LOT-A')).toBeInTheDocument()
  })

  it('surfaces the offline toast instead of opening the picker', async () => {
    reachableRef.current = false
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('consume-one'))

    expect(await screen.findAllByText(/not available offline/i)).not.toHaveLength(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // ── Scan to prefill (T028) ────────────────────────────────────────────────

  const GS = '\u001d'
  const GTIN = '09506000134376'
  const yymmdd = (iso) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10)
  const futureIso = daysFromNow(200)
  const pastIso = daysFromNow(-30)
  const fullPayload = `01${GTIN}17${yymmdd(futureIso)}10LOT-SCAN${GS}21SN-NEW`

  const openScanner = async (user) => {
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('add-lot-toggle'))
    await user.click(screen.getByTestId('scan-lot'))
    await user.click(await screen.findByTestId('stub-decode'))
  }

  const captureCreateLot = () => {
    const captured = { body: null, calls: 0 }
    server.use(
      http.post(`${BASE}/stock/1/lots/`, async ({ request }) => {
        captured.calls += 1
        captured.body = await request.json()
        return HttpResponse.json({ id: 900, quantity: 1 }, { status: 201 })
      }),
    )
    return captured
  }

  it('does not offer the camera when the scanner cannot work', async () => {
    scannerAvailableRef.current = false
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('add-lot-toggle'))

    expect(screen.queryByTestId('scan-lot')).not.toBeInTheDocument()
  })

  it('fills quantity, expiry, lot number and the serial chip from a scan', async () => {
    payloadRef.current = fullPayload
    const { user } = renderDetail()
    await openScanner(user)

    expect(screen.getByPlaceholderText('0')).toHaveValue(1)
    expect(screen.getByDisplayValue(futureIso)).toBeInTheDocument()
    expect(screen.getByDisplayValue('LOT-SCAN')).toBeInTheDocument()
    expect(screen.getByTestId('serial-input')).toHaveValue('SN-NEW')
    // An accepted read closes the camera.
    expect(screen.queryByTestId('scanner')).not.toBeInTheDocument()
  })

  it('posts the serial and the raw payload when the scan is confirmed', async () => {
    payloadRef.current = fullPayload
    const captured = captureCreateLot()
    const { user } = renderDetail()
    await openScanner(user)
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    await waitFor(() => expect(captured.body).not.toBeNull())
    expect(captured.body).toMatchObject({
      quantity: 1,
      lot_number: 'LOT-SCAN',
      expiry_date: futureIso,
      serial_number: 'SN-NEW',
      raw_scan: fullPayload,
    })
  })

  it('drops the serial from the submitted body when the chip is cleared', async () => {
    payloadRef.current = fullPayload
    const captured = captureCreateLot()
    const { user } = renderDetail()
    await openScanner(user)
    await user.clear(screen.getByTestId('serial-input'))
    expect(screen.getByTestId('serial-input')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    await waitFor(() => expect(captured.body).not.toBeNull())
    expect(captured.body.serial_number).toBe('')
    // The payload survives: clearing the chip says "do not track this as one
    // physical pack", not "forget the scan". The GTIN inside is the only
    // record of which product this is.
    expect(captured.body.raw_scan).toBe(fullPayload)
  })

  // ── Product identity reconciliation (T033) ────────────────────────────────

  const noSerialPayload = `01${GTIN}17${yymmdd(futureIso)}10LOT-NOSER`

  const capturePatch = () => {
    const captured = { body: null, calls: 0 }
    server.use(
      http.patch(`${BASE}/stock/1/`, async ({ request }) => {
        captured.calls += 1
        captured.body = await request.json()
        return HttpResponse.json({ ...stock, ...captured.body })
      }),
    )
    return captured
  }

  const stockWith = (extra) => server.use(http.get(`${BASE}/stock/1/`, () => HttpResponse.json({ ...stock, ...extra })))

  it('stores the payload of a scanned code that carries no serial', async () => {
    // The regression this fixes: `rawScan` used to be sent only when the code
    // had an AI 21, so a serial-less pack lost its GTIN forever.
    payloadRef.current = noSerialPayload
    const captured = captureCreateLot()
    const { user } = renderDetail()
    await openScanner(user)
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    await waitFor(() => expect(captured.body).not.toBeNull())
    expect(captured.body.serial_number).toBe('')
    expect(captured.body.raw_scan).toBe(noSerialPayload)
  })

  it('sends an empty payload for a hand-typed lot', async () => {
    const captured = captureCreateLot()
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('add-lot-toggle'))
    await user.type(screen.getByPlaceholderText('0'), '3')
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    await waitFor(() => expect(captured.body).not.toBeNull())
    expect(captured.body.raw_scan).toBe('')
  })

  it('prefills the quantity from the product default, and leaves it empty without one', async () => {
    stockWith({ default_lot_quantity: 5 })
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('add-lot-toggle'))
    expect(screen.getByPlaceholderText('0')).toHaveValue(5)
  })

  it('does not let a scan overwrite the prefilled quantity', async () => {
    stockWith({ default_lot_quantity: 5 })
    payloadRef.current = fullPayload
    const { user } = renderDetail()
    await openScanner(user)

    // Without a default the scan sets 1; with one, the preference wins.
    expect(screen.getByPlaceholderText('0')).toHaveValue(5)
  })

  it('assigns both values with no prompt when the product knows nothing', async () => {
    payloadRef.current = fullPayload
    const lot = captureCreateLot()
    const patch = capturePatch()
    const { user } = renderDetail()
    await openScanner(user)
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    await waitFor(() => expect(patch.body).not.toBeNull())
    expect(patch.body).toEqual({ gtin: GTIN, default_lot_quantity: 1 })
    expect(screen.queryByTestId('stock-values-confirm')).not.toBeInTheDocument()
    expect(lot.calls).toBe(1)
  })

  it('issues no PATCH at all when everything already matches', async () => {
    stockWith({ gtin: GTIN, default_lot_quantity: 5 })
    payloadRef.current = fullPayload
    const lot = captureCreateLot()
    const patch = capturePatch()
    const { user } = renderDetail()
    await openScanner(user)
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    await waitFor(() => expect(lot.calls).toBe(1))
    expect(patch.calls).toBe(0)
    expect(screen.queryByTestId('stock-values-confirm')).not.toBeInTheDocument()
  })

  it('asks before redefining a differing quantity, and writes it when accepted', async () => {
    stockWith({ gtin: GTIN, default_lot_quantity: 10 })
    payloadRef.current = fullPayload
    const lot = captureCreateLot()
    const patch = capturePatch()
    const { user } = renderDetail()
    await openScanner(user)
    const qty = screen.getByPlaceholderText('0')
    await user.clear(qty)
    await user.type(qty, '6')
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    expect(await screen.findByTestId('stock-values-confirm')).toBeInTheDocument()
    expect(lot.calls).toBe(0)
    await user.click(screen.getByTestId('stock-values-update'))

    await waitFor(() => expect(patch.body).not.toBeNull())
    expect(patch.body).toEqual({ default_lot_quantity: 6 })
    expect(lot.calls).toBe(1)
  })

  it('creates the lot and writes nothing when the change is declined', async () => {
    stockWith({ gtin: GTIN, default_lot_quantity: 10 })
    payloadRef.current = fullPayload
    const lot = captureCreateLot()
    const patch = capturePatch()
    const { user } = renderDetail()
    await openScanner(user)
    const qty = screen.getByPlaceholderText('0')
    await user.clear(qty)
    await user.type(qty, '6')
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    await user.click(await screen.findByTestId('stock-values-keep'))

    await waitFor(() => expect(lot.calls).toBe(1))
    expect(patch.calls).toBe(0)
  })

  it('hands the form back with everything in it when the lot fails after the prompt', async () => {
    // The prompt holds the form's submit promise open until the user answers.
    // If the save then fails, rejecting is what keeps the typed values on
    // screen — resolving would clear a form whose lot was never created.
    stockWith({ gtin: GTIN, default_lot_quantity: 10 })
    payloadRef.current = fullPayload
    server.use(http.post(`${BASE}/stock/1/lots/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderDetail()
    await openScanner(user)
    const qty = screen.getByPlaceholderText('0')
    await user.clear(qty)
    await user.type(qty, '6')
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    await user.click(await screen.findByTestId('stock-values-update'))

    await waitFor(() => expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument())
    expect(screen.getByPlaceholderText('0')).toHaveValue(6)
  })

  it('reconciles a hand-typed lot too, without touching the stored GTIN', async () => {
    stockWith({ gtin: GTIN, default_lot_quantity: 10 })
    const lot = captureCreateLot()
    const patch = capturePatch()
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('add-lot-toggle'))
    const qty = screen.getByPlaceholderText('0')
    await user.clear(qty)
    await user.type(qty, '6')
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    await user.click(await screen.findByTestId('stock-values-update'))
    await waitFor(() => expect(patch.body).not.toBeNull())
    // Only the quantity: a typed lot carries no product code.
    expect(patch.body).toEqual({ default_lot_quantity: 6 })
    expect(lot.calls).toBe(1)
  })

  it('fills a blank field silently while a set one matches', async () => {
    stockWith({ gtin: GTIN, default_lot_quantity: null })
    payloadRef.current = fullPayload
    const patch = capturePatch()
    const { user } = renderDetail()
    await openScanner(user)
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    await waitFor(() => expect(patch.body).not.toBeNull())
    expect(patch.body).toEqual({ default_lot_quantity: 1 })
    expect(screen.queryByTestId('stock-values-confirm')).not.toBeInTheDocument()
  })

  it('creates the lot even when the product update is rejected', async () => {
    payloadRef.current = fullPayload
    const lot = captureCreateLot()
    server.use(http.patch(`${BASE}/stock/1/`, () => HttpResponse.json({ detail: 'nope' }, { status: 500 })))
    const { user } = renderDetail()
    await openScanner(user)
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    await waitFor(() => expect(lot.calls).toBe(1))
  })

  it('never offers the product update to a guest', async () => {
    stockWith({ is_owner: false, gtin: GTIN, default_lot_quantity: 10 })
    payloadRef.current = fullPayload
    const lot = captureCreateLot()
    const patch = capturePatch()
    const { user } = renderDetail()
    await openScanner(user)
    const qty = screen.getByPlaceholderText('0')
    await user.clear(qty)
    await user.type(qty, '6')
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    await waitFor(() => expect(lot.calls).toBe(1))
    expect(screen.queryByTestId('stock-values-confirm')).not.toBeInTheDocument()
    expect(patch.calls).toBe(0)
  })

  it('keeps the camera open and explains an unrecognised code', async () => {
    payloadRef.current = 'this is not a barcode'
    const { user } = renderDetail()
    await openScanner(user)

    expect(screen.getByTestId('scanner')).toBeInTheDocument()
    expect(screen.getByTestId('scan-notice')).toHaveTextContent('Code not recognised')
    // The form was left exactly as it was.
    expect(screen.getByPlaceholderText('0')).toHaveValue(null)
  })

  it('refuses to add an expired pack', async () => {
    payloadRef.current = `01${GTIN}17${yymmdd(pastIso)}10OLD-LOT${GS}21SN-OLD`
    const captured = captureCreateLot()
    const { user } = renderDetail()
    await openScanner(user)

    expect(screen.getByTestId('scan-blocker')).toHaveTextContent(/expired/i)
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    expect(captured.calls).toBe(0)
  })

  it('refuses to add a pack whose serial is already in the stock', async () => {
    useStockResponse(serializedStock())
    payloadRef.current = `01${GTIN}17${yymmdd(futureIso)}10LOT-S${GS}21SN-1`
    const captured = captureCreateLot()
    const { user } = renderDetail()
    await openScanner(user)

    expect(screen.getByTestId('scan-blocker')).toHaveTextContent(/already registered/i)
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    expect(captured.calls).toBe(0)
  })

  it('fills only what a partial payload carries, leaving the rest alone', async () => {
    payloadRef.current = `10LOT-ONLY`
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('add-lot-toggle'))

    // An expiry the user typed before scanning must survive a code that says
    // nothing about it.
    const expiryInput = document.querySelector('input[type="date"]')
    fireEvent.change(expiryInput, { target: { value: futureIso } })

    await user.click(screen.getByTestId('scan-lot'))
    await user.click(await screen.findByTestId('stub-decode'))

    expect(screen.getByDisplayValue('LOT-ONLY')).toBeInTheDocument()
    expect(expiryInput).toHaveValue(futureIso)
    expect(screen.getByPlaceholderText('0')).toHaveValue(1)
    expect(screen.queryByTestId('serial-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('scan-blocker')).not.toBeInTheDocument()
  })

  // ── Offline and empty-state guards ───────────────────────────────────────

  it('refuses to open the picker for a stock the server says has no lots', async () => {
    useStockResponse({ ...stock, lots: [] })
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('consume-one'))

    expect(await screen.findAllByText(/went wrong/i)).not.toHaveLength(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('refuses to add a lot when the network drops with the form already open', async () => {
    const captured = captureCreateLot()
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    // Opening the form has its own guard, so the only way to reach the one
    // inside the submit handler is to lose the network while it is open.
    await user.click(screen.getByTestId('add-lot-toggle'))
    reachableRef.current = false
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '2' } })
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    expect(await screen.findAllByText(/not available offline/i)).not.toHaveLength(0)
    expect(captured.calls).toBe(0)
  })

  it('marks the pack delete button unavailable offline and refuses the click', async () => {
    useStockResponse(serializedStock())
    reachableRef.current = false
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('group-expander'))

    const del = within(screen.getAllByTestId('pack-row')[0]).getByRole('button')
    expect(del).toHaveAttribute('aria-disabled', 'true')
    expect(del).toHaveAttribute('title', 'This section is not available offline.')
    await user.click(del)

    expect(await screen.findAllByText(/not available offline/i)).not.toHaveLength(0)
    // No confirmation either: the action never got far enough to ask.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('collapses an expanded group when the expander is pressed again', async () => {
    useStockResponse(serializedStock())
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('group-expander'))
    expect(screen.getAllByTestId('pack-row')).toHaveLength(2)

    await user.click(screen.getByTestId('group-expander'))
    expect(screen.queryAllByTestId('pack-row')).toHaveLength(0)
  })

  it('labels a box with no serial inside an expanded group', async () => {
    useStockResponse({
      ...stock,
      lots: [
        {
          id: 300,
          quantity: 1,
          expiry_date: daysFromNow(90),
          lot_number: 'LOT-X',
          serial_number: 'SN-X',
          updated_at: '2026-04-17T10:00:00Z',
        },
        {
          id: 301,
          quantity: 3,
          expiry_date: daysFromNow(90),
          lot_number: 'LOT-X',
          serial_number: '',
          updated_at: '2026-04-17T10:00:00Z',
        },
      ],
    })
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('group-expander'))

    const rows = screen.getAllByTestId('pack-row')
    expect(within(rows[0]).getByText('SN-X')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Unidentified units')).toBeInTheDocument()
  })

  it('keeps an expiry blocker when the serial chip is cleared', async () => {
    payloadRef.current = `01${GTIN}17${yymmdd(pastIso)}10OLD-LOT${GS}21SN-OLD`
    const { user } = renderDetail()
    await openScanner(user)
    expect(screen.getByTestId('scan-blocker')).toHaveTextContent(/expired/i)

    // Clearing the serial only answers the duplicate-serial objection. The
    // pack is still out of date, so the blocker must survive.
    await user.clear(screen.getByTestId('serial-input'))
    expect(screen.getByTestId('serial-input')).toHaveValue('')
    expect(screen.getByTestId('scan-blocker')).toHaveTextContent(/expired/i)
  })

  it('reads zero when the payload carries neither quantity field', async () => {
    useStockResponse({ ...stock, quantity: undefined, quantity_available: undefined })
    renderDetail()
    await screen.findByText('Water filter')

    expect(screen.getByText(/0 total/)).toBeInTheDocument()
    expect(screen.queryByTestId('consume-one')).not.toBeInTheDocument()
  })

  it('marks the depletion date as an estimate when the server says so', async () => {
    useStockResponse({
      ...stock,
      estimated_depletion_date: daysFromNow(45),
      depletion_is_estimated: true,
    })
    renderDetail()
    await screen.findByText('Water filter')

    const span = screen.getByTestId('depletion-date')
    expect(span).toHaveAttribute('title', 'Estimated from past usage')
    expect(span.querySelector('svg use[href="#i-equal-approximately"]')).not.toBeNull()
  })

  it('cancel in the add-lot form closes it and clears the qty input', async () => {
    const { user } = renderDetail()
    await screen.findByText('Water filter')
    await user.click(screen.getByTestId('add-lot-toggle'))
    const qty = screen.getByPlaceholderText('0')
    await user.type(qty, '7')
    expect(qty).toHaveValue(7)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    // Form is gone and re-opening it shows an empty qty (state was reset).
    expect(screen.queryByPlaceholderText('0')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('add-lot-toggle'))
    expect(screen.getByPlaceholderText('0')).toHaveValue(null)
  })
})
