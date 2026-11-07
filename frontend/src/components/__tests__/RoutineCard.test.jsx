import { QueryClient } from '@tanstack/react-query'
import { act, fireEvent, screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '../../test/helpers'
import RoutineCard, { COLLAPSE_MS, EXIT_MS } from '../RoutineCard'

function clientWithStock(stock) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  qc.setQueryData(['stock'], [stock])
  return qc
}

const baseRoutine = {
  id: 1,
  name: 'Take vitamins',
  next_due_at: new Date(Date.now() + 3600000).toISOString(),
  created_at: '2025-01-15T10:00:00Z',
  is_due: true,
  is_overdue: true,
  hours_until_due: -2,
  stock_name: null,
  stock_quantity: null,
  stock_usage: 1,
}

const depleted = {
  stock_name: 'Ibuprofen',
  stock_quantity: 0,
  stock_quantity_available: 0,
  stock_usage: 1,
}

function renderCard(routine = baseRoutine, { onMarkDone = vi.fn(), completing = false, ...options } = {}) {
  const view = renderWithProviders(
    <Routes>
      <Route path="/" element={<RoutineCard routine={routine} onMarkDone={onMarkDone} completing={completing} />} />
      <Route path="/routines/:id" element={<div>Detail page</div>} />
    </Routes>,
    { initialEntries: ['/'], ...options },
  )
  return { ...view, onMarkDone }
}

const checkButton = () => screen.getByRole('button', { name: 'Mark as done' })
const row = () => screen.getByTestId('routine-card')
const cardLink = () => screen.getByTestId('routine-card-link')
const layer = () => screen.getByTestId('routine-action-layer')

// The card is 300px wide, so the swipe threshold sits at 114px.
function swipeRight(target, distance) {
  fireEvent.pointerDown(target, { pointerId: 1, isPrimary: true, button: 0, clientX: 0, clientY: 0 })
  for (let x = 20; x <= distance; x += 20) {
    act(() => vi.advanceTimersByTime(50))
    fireEvent.pointerMove(target, { pointerId: 1, clientX: x, clientY: 0 })
  }
}
function release(target, x) {
  act(() => vi.advanceTimersByTime(50))
  fireEvent.pointerUp(target, { pointerId: 1, clientX: x, clientY: 0 })
}

function runExit() {
  act(() => vi.advanceTimersByTime(EXIT_MS))
  act(() => vi.advanceTimersByTime(COLLAPSE_MS))
}

function setReducedMotion(matches) {
  window.matchMedia = vi.fn((query) => ({
    matches: matches && query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

describe('RoutineCard', () => {
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 300 })
    Element.prototype.setPointerCapture = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete Element.prototype.setPointerCapture
    window.matchMedia = originalMatchMedia
    delete navigator.vibrate
  })

  it('renders routine name and time', () => {
    renderCard()
    expect(screen.getByText('Take vitamins')).toBeInTheDocument()
  })

  it('shows stock usage per execution when stock is linked', () => {
    renderCard({ ...baseRoutine, stock_name: 'Filters', stock_quantity: 5, stock_usage: 2 })
    expect(screen.getByText(/2 × Filters/)).toBeInTheDocument()
    expect(screen.queryByText(/5/)).not.toBeInTheDocument()
  })

  it('shows "Since" label when no next_due_at', () => {
    renderCard({ ...baseRoutine, next_due_at: null })
    expect(screen.getByText(/Since/)).toBeInTheDocument()
  })

  // ── Action layer ───────────────────────────────────────────────────────────

  it('gives a due routine the check button as the first focus stop, before the card link', () => {
    renderCard()
    const check = checkButton()
    expect(check).toBeInTheDocument()
    expect(check.compareDocumentPosition(cardLink()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(row().querySelectorAll('button, a')[0]).toBe(check)
  })

  it('gives a not-due routine the same action layer and check (T102)', () => {
    renderCard({ ...baseRoutine, is_due: false, is_overdue: false })
    expect(checkButton()).not.toHaveAttribute('aria-disabled')
    expect(layer()).toHaveAttribute('data-state', 'idle')
    expect(cardLink()).toHaveAttribute('href', '/routines/1')
  })

  it('flags the row as highlighted only while the prop is set', () => {
    const { rerender } = renderWithProviders(<RoutineCard routine={baseRoutine} onMarkDone={vi.fn()} highlighted />)
    expect(row()).toHaveAttribute('data-highlighted', 'true')
    rerender(<RoutineCard routine={baseRoutine} onMarkDone={vi.fn()} highlighted={false} />)
    expect(row()).not.toHaveAttribute('data-highlighted')
  })

  it('brings a completed card back to rest when the routine is re-dated in place', () => {
    vi.useFakeTimers()
    const routine = { ...baseRoutine, is_due: false, is_overdue: false }
    const onMarkDone = vi.fn()
    const { rerender } = renderWithProviders(
      <RoutineCard routine={routine} onMarkDone={onMarkDone} completing={false} />,
    )
    fireEvent.click(checkButton())
    runExit()
    expect(row()).toHaveAttribute('data-phase', 'collapsing')
    const redated = { ...routine, next_due_at: '2099-01-01T00:00:00.000Z', last_entry_at: '2026-11-04T10:00:00.000Z' }
    rerender(<RoutineCard routine={redated} onMarkDone={onMarkDone} completing={false} />)
    expect(row()).toHaveAttribute('data-phase', 'rest')
  })

  it('plays the exit on check click and only then calls onMarkDone with the id', () => {
    vi.useFakeTimers()
    const { onMarkDone } = renderCard()
    fireEvent.click(checkButton())
    expect(row()).toHaveAttribute('data-phase', 'leaving')
    expect(onMarkDone).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(EXIT_MS))
    expect(row()).toHaveAttribute('data-phase', 'collapsing')
    expect(onMarkDone).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(COLLAPSE_MS))
    expect(onMarkDone).toHaveBeenCalledTimes(1)
    expect(onMarkDone).toHaveBeenCalledWith(1, { revert: expect.any(Function) })
  })

  it('calls onMarkDone right away under prefers-reduced-motion', () => {
    setReducedMotion(true)
    const { onMarkDone } = renderCard()
    fireEvent.click(checkButton())
    expect(onMarkDone).toHaveBeenCalledWith(1, { revert: expect.any(Function) })
    expect(row()).toHaveAttribute('data-phase', 'collapsing')
  })

  it('runs the same exit when the card is swiped past the threshold', () => {
    vi.useFakeTimers()
    const { onMarkDone } = renderCard()
    swipeRight(cardLink(), 160)
    expect(layer()).toHaveAttribute('data-state', 'armed')
    release(cardLink(), 160)
    expect(row()).toHaveAttribute('data-phase', 'leaving')
    runExit()
    expect(onMarkDone).toHaveBeenCalledTimes(1)
    expect(onMarkDone).toHaveBeenCalledWith(1, { revert: expect.any(Function) })
  })

  it('blocks a stock-depleted routine: red layer, aria-disabled check with the reason, no completion', () => {
    vi.useFakeTimers()
    const { onMarkDone } = renderCard({ ...baseRoutine, ...depleted })
    const check = checkButton()
    expect(layer()).toHaveAttribute('data-state', 'blocked')
    expect(check).toHaveAttribute('aria-disabled', 'true')
    expect(check).toHaveAttribute('title', 'No stock available')
    fireEvent.click(check)
    expect(cardLink().className).toContain('nudging')
    runExit()
    expect(onMarkDone).not.toHaveBeenCalled()
    expect(row()).toHaveAttribute('data-phase', 'rest')
  })

  it('blocks a routine whose available stock is below the usage even when the total is high', () => {
    // T165: 10 units in total but all expired (available 0). The legacy
    // `stock_quantity` would allow it; `stock_quantity_available` blocks it.
    renderCard({ ...baseRoutine, ...depleted, stock_quantity: 10 })
    expect(layer()).toHaveAttribute('data-state', 'blocked')
  })

  it('makes the check inert while the completion is in flight', () => {
    vi.useFakeTimers()
    const { onMarkDone } = renderCard(baseRoutine, { completing: true })
    expect(checkButton()).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(checkButton())
    runExit()
    expect(row()).toHaveAttribute('data-phase', 'rest')
    expect(onMarkDone).not.toHaveBeenCalled()
  })

  it('navigates to the detail on tap', () => {
    renderCard()
    fireEvent.click(cardLink())
    expect(screen.getByText('Detail page')).toBeInTheDocument()
  })

  it('does not navigate after a drag', () => {
    vi.useFakeTimers()
    renderCard()
    swipeRight(cardLink(), 60)
    release(cardLink(), 60)
    fireEvent.click(cardLink())
    expect(screen.queryByText('Detail page')).not.toBeInTheDocument()
  })

  it('vibrates once when the swipe crosses the threshold', () => {
    vi.useFakeTimers()
    navigator.vibrate = vi.fn()
    renderCard()
    swipeRight(cardLink(), 160)
    expect(navigator.vibrate).toHaveBeenCalledTimes(1)
    expect(navigator.vibrate).toHaveBeenCalledWith(10)
    // Disarming stays silent; arming again within the same drag buzzes again.
    fireEvent.pointerMove(cardLink(), { pointerId: 1, clientX: 80, clientY: 0 })
    expect(navigator.vibrate).toHaveBeenCalledTimes(1)
    fireEvent.pointerMove(cardLink(), { pointerId: 1, clientX: 150, clientY: 0 })
    expect(navigator.vibrate).toHaveBeenCalledTimes(2)
  })

  it('revert() brings the card back to rest after the exit', () => {
    vi.useFakeTimers()
    const onMarkDone = vi.fn((_id, { revert }) => revert())
    renderCard(baseRoutine, { onMarkDone })
    fireEvent.click(checkButton())
    runExit()
    expect(onMarkDone).toHaveBeenCalledTimes(1)
    expect(row()).toHaveAttribute('data-phase', 'rest')
    expect(layer()).toHaveAttribute('data-state', 'idle')
  })

  it('still fires the completion when the card unmounts mid-exit', () => {
    vi.useFakeTimers()
    const { onMarkDone, unmount } = renderCard()
    fireEvent.click(checkButton())
    unmount()
    expect(onMarkDone).toHaveBeenCalledTimes(1)
  })

  // ── Press feedback (T107) ──────────────────────────────────────────────────
  // `data-pressed` drives the darker, 0.98-scaled card in CSS (verified in the
  // browser); here only the state machine.

  const press = (extra = {}) =>
    fireEvent.pointerDown(cardLink(), { pointerId: 1, isPrimary: true, button: 0, clientX: 0, clientY: 0, ...extra })

  it('marks the row pressed while the main pointer is down', () => {
    renderCard()
    press()
    expect(row()).toHaveAttribute('data-pressed', 'true')
  })

  it.each([
    ['release', () => fireEvent.pointerUp(cardLink(), { pointerId: 1, clientX: 0, clientY: 0 })],
    ['cancel (the browser takes over a scroll)', () => fireEvent.pointerCancel(cardLink(), { pointerId: 1 })],
    ['leave', () => fireEvent.pointerLeave(cardLink(), { pointerId: 1 })],
  ])('clears the pressed state on %s', (_, end) => {
    renderCard()
    press()
    end()
    expect(row()).not.toHaveAttribute('data-pressed')
  })

  it('ignores a secondary button', () => {
    renderCard()
    press({ button: 2 })
    expect(row()).not.toHaveAttribute('data-pressed')
  })

  it('does not press a card whose completion is in flight', () => {
    renderCard(baseRoutine, { completing: true })
    press()
    expect(row()).not.toHaveAttribute('data-pressed')
  })

  // ── Status dot ─────────────────────────────────────────────────────────────
  // The dot and the time text say when (T106): stock never recolours them.

  it('colours the dot red when overdue', () => {
    const { container } = renderCard({ ...baseRoutine, is_due: true, is_overdue: true })
    expect(container.querySelector('[class*="dotDanger"]')).toBeInTheDocument()
  })

  it('colours the dot amber when due today but not yet overdue', () => {
    const { container } = renderCard({ ...baseRoutine, is_due: true, is_overdue: false, hours_until_due: 3 })
    expect(container.querySelector('[class*="dotWarning"]')).toBeInTheDocument()
  })

  it('colours the dot green when not due', () => {
    const { container } = renderCard({ ...baseRoutine, is_due: false, is_overdue: false, hours_until_due: 24 })
    expect(container.querySelector('[class*="dotSuccess"]')).toBeInTheDocument()
  })

  // The touch strip's colour comes from `data-status` in the CSS; jsdom has no
  // media queries, so the colour itself is checked in the browser.
  it.each([
    ['overdue', { is_due: true, is_overdue: true }],
    ['due', { is_due: true, is_overdue: false, hours_until_due: 3 }],
    ['ok', { is_due: false, is_overdue: false, hours_until_due: 24 }],
  ])('exposes the time status "%s" on the row for the resting strip', (status, timing) => {
    renderCard({ ...baseRoutine, ...timing })
    expect(row()).toHaveAttribute('data-status', status)
  })

  it('keeps the time status on a row the stock blocks', () => {
    // The CSS paints a blocked strip grey whatever the status; the status
    // itself stays the time's, like the dot.
    renderCard({ ...baseRoutine, ...depleted, is_due: true, is_overdue: true })
    expect(row()).toHaveAttribute('data-status', 'overdue')
    expect(layer()).toHaveAttribute('data-state', 'blocked')
  })

  it('keeps the green dot and time for a not-yet-due routine whose stock is depleted', () => {
    // "In 10 days" in red read as urgent when the problem was the stock.
    const { container } = renderCard({ ...baseRoutine, ...depleted, is_due: false, is_overdue: false })
    expect(container.querySelector('[class*="dotSuccess"]')).toBeInTheDocument()
    expect(container.querySelector('[class*="dotDanger"]')).not.toBeInTheDocument()
    expect(container.querySelector('[class*="statusOk"]')).toBeInTheDocument()
  })

  it('puts the depletion reason on the stock line, in red', () => {
    renderCard({ ...baseRoutine, ...depleted })
    const line = screen.getByTestId('stock-line')
    expect(line).toHaveTextContent('Out of stock · Ibuprofen')
    expect(line.className).toContain('stockDepletionDanger')
    expect(screen.getByTestId('stock-icon').getAttribute('class')).toContain('iconDanger')
    expect(screen.queryByText(/1 × Ibuprofen/)).not.toBeInTheDocument()
  })

  it('keeps the green dot when the linked stock has enough quantity', () => {
    const { container } = renderCard({
      ...baseRoutine,
      is_due: false,
      is_overdue: false,
      stock_name: 'Descaler tablets',
      stock_quantity: 5,
      stock_quantity_available: 5,
      stock_usage: 1,
    })
    expect(container.querySelector('[class*="dotSuccess"]')).toBeInTheDocument()
  })

  // ── Sharing ────────────────────────────────────────────────────────────────
  // Sharing is edited from the routine form (ShareWithSection). The card
  // shows a passive indicator right after the name (T107): a bare icon with
  // role="img", the same for owner and recipient. The inline owner-username
  // label was removed in T134 — the indicator's label carries the owner's
  // name for the recipient case instead.

  it('does not expose an interactive share button', () => {
    renderCard({ ...baseRoutine, shared_with: [10], is_owner: true, owner_display_name: 'testuser' })
    expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument()
  })

  it('puts the shared indicator inside the title, right after the name', () => {
    renderCard({ ...baseRoutine, shared_with: [10], is_owner: true })
    const badge = screen.getByTestId('shared-badge')
    expect(screen.getByText('Take vitamins').nextElementSibling).toBe(badge)
    expect(badge.closest('[class*="cardTitle"]')).not.toBeNull()
  })

  it('renders the owner variant as an image named for the owner', () => {
    renderCard({ ...baseRoutine, shared_with: [10], is_owner: true })
    const badge = screen.getByRole('img', { name: 'Shared with others' })
    expect(badge).toHaveAttribute('data-variant', 'owner')
    expect(badge.className).toBe('sharedIcon')
  })

  it('renders the recipient variant as an image naming who shares it, with the same look', () => {
    renderCard({ ...baseRoutine, shared_with: [], is_owner: false, owner_display_name: 'alice' })
    const badge = screen.getByRole('img', { name: 'Shared with you by alice' })
    expect(badge).toHaveAttribute('data-variant', 'recipient')
    expect(badge.className).toBe('sharedIcon')
  })

  it('draws the chevron as hidden decoration, not a button', () => {
    const { container } = renderCard()
    const chevron = container.querySelector('use[href="#i-chevron-right"]').closest('svg')
    expect(chevron).toHaveAttribute('aria-hidden', 'true')
    expect(chevron.closest('button')).toBeNull()
    expect(chevron.getAttribute('class')).toBe('icon icon-sm chevron')
  })

  it('omits the badge entirely when the owner has not shared the routine', () => {
    renderCard({ ...baseRoutine, shared_with: [], is_owner: true, owner_display_name: 'testuser' })
    expect(screen.queryByTestId('shared-badge')).not.toBeInTheDocument()
  })

  it('never renders the inline owner-label, regardless of role', () => {
    for (const overrides of [
      { shared_with: [], is_owner: true, owner_display_name: 'testuser' },
      { shared_with: [10], is_owner: true, owner_display_name: 'testuser' },
      { shared_with: [], is_owner: false, owner_display_name: 'alice' },
    ]) {
      const { unmount } = renderCard({ ...baseRoutine, ...overrides })
      expect(screen.queryByTestId('owner-label')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('interpolates the owner username into the recipient badge aria-label', () => {
    renderCard({ ...baseRoutine, shared_with: [], is_owner: false, owner_display_name: 'alice' })
    const badge = screen.getByTestId('shared-badge')
    expect(badge.getAttribute('aria-label')).toContain('alice')
    expect(badge.getAttribute('title')).toContain('alice')
  })

  // ── Stock severity icon tint ───────────────────────────────────────────────
  // The package icon next to the linked stock is tinted only when there is a
  // problem (T106): amber for `low`, red for `critical`. A healthy stock, or a
  // cold cache (dashboard reached before the stock list resolved), leaves it
  // neutral — the bare `icon icon-sm` classes.

  it('tints the stock icon red when the cached stock_severity is critical', () => {
    // T165: 'critical' replaces the old 'out' as the red tier and now also
    // covers running-out-fast and all-expired cases. See T164. Two units
    // still cover a completion, so this is the tint, not the depleted line.
    const routine = { ...baseRoutine, stock: 7, stock_name: 'Ibuprofen', stock_quantity: 2, stock_usage: 1 }
    renderCard(routine, { queryClient: clientWithStock({ id: 7, stock_severity: 'critical' }) })
    expect(screen.getByTestId('stock-icon').getAttribute('class')).toContain('iconDanger')
    expect(screen.getByTestId('stock-line')).toHaveTextContent('1 × Ibuprofen')
  })

  it('tints the stock icon amber when the cached stock_severity is low', () => {
    const routine = { ...baseRoutine, stock: 7, stock_name: 'Filters', stock_quantity: 2, stock_usage: 1 }
    renderCard(routine, { queryClient: clientWithStock({ id: 7, stock_severity: 'low' }) })
    expect(screen.getByTestId('stock-icon').getAttribute('class')).toContain('iconWarning')
  })

  it('leaves the stock icon untinted when the cached stock_severity is ok', () => {
    const routine = { ...baseRoutine, stock: 7, stock_name: 'Filters', stock_quantity: 5, stock_usage: 1 }
    renderCard(routine, { queryClient: clientWithStock({ id: 7, stock_severity: 'ok' }) })
    expect(screen.getByTestId('stock-icon').getAttribute('class')).toBe('icon icon-sm')
  })

  // T165: documents the no-worst-of-two contract — `iconClassForStock` looks
  // only at `stock_severity`. Even a soon/reached lot expiry never bubbles
  // into the routine card's stock badge tint.
  it('iconClassForStock ignores expiry_severity=soon when stock_severity is ok', () => {
    const routine = { ...baseRoutine, stock: 7, stock_name: 'Filters', stock_quantity: 5, stock_usage: 1 }
    renderCard(routine, { queryClient: clientWithStock({ id: 7, stock_severity: 'ok', expiry_severity: 'soon' }) })
    expect(screen.getByTestId('stock-icon').getAttribute('class')).toBe('icon icon-sm')
  })

  it('leaves the stock icon untinted when the stock cache is cold', () => {
    renderCard({ ...baseRoutine, stock: 7, stock_name: 'Filters', stock_quantity: 5, stock_usage: 1 })
    expect(screen.getByTestId('stock-icon').getAttribute('class')).toBe('icon icon-sm')
  })
})
