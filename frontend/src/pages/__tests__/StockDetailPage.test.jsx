import { screen, waitFor, within } from '@testing-library/react'
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
    const lotInput = screen.getByPlaceholderText('Batch ID (optional)')
    await user.click(lotInput)
    const suggestion = await screen.findByRole('option', { name: 'LOT-A' })
    await user.click(suggestion)
    expect(lotInput).toHaveValue('LOT-A')
    expect(screen.queryByRole('option', { name: 'LOT-A' })).not.toBeInTheDocument()
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
