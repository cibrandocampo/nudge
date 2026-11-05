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

  // ── Status dot ─────────────────────────────────────────────────────────────
  // The coloured edge now means the action; the status lives in the dot.

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

  it('escalates the dot to red when stock is depleted, even for a not-yet-due routine', () => {
    // Without this, a routine with `next_due_at` 60 days ahead and 0 units
    // looks identical to one in perfect shape.
    const { container } = renderCard({ ...baseRoutine, ...depleted, is_due: false, is_overdue: false })
    expect(container.querySelector('[class*="dotDanger"]')).toBeInTheDocument()
    expect(container.querySelector('[class*="dotSuccess"]')).not.toBeInTheDocument()
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
  // surfaces a passive `shared-badge` for both owner (filled variant) and
  // recipient (outlined variant). The inline owner-username label was
  // removed in T134 — the badge's `aria-label` carries the owner's name
  // for the recipient case instead.

  it('does not expose an interactive share button', () => {
    renderCard({ ...baseRoutine, shared_with: [], is_owner: true, owner_display_name: 'testuser' })
    expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument()
  })

  it('renders the owner-variant badge when the user owns and has shared the routine', () => {
    renderCard({ ...baseRoutine, shared_with: [10], is_owner: true })
    const badge = screen.getByTestId('shared-badge')
    expect(badge.getAttribute('data-variant')).toBe('owner')
    expect(badge.className).toContain('btnIconShared')
    expect(badge.className).not.toContain('btnIconSharedRecipient')
  })

  it('renders the recipient-variant badge when the user is not the owner', () => {
    renderCard({ ...baseRoutine, shared_with: [], is_owner: false, owner_display_name: 'alice' })
    const badge = screen.getByTestId('shared-badge')
    expect(badge.getAttribute('data-variant')).toBe('recipient')
    expect(badge.className).toContain('btnIconSharedRecipient')
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
  // The package icon next to the linked stock takes its colour from the
  // cached stock's `stock_severity`. When the stock cache is cold (e.g. user
  // landed on the dashboard before the stock list resolved), the icon falls
  // back to the badge's default text colour and stays neutral.

  it('tints the stock icon red when the cached stock_severity is critical', () => {
    // T165: 'critical' replaces the old 'out' as the red tier and now also
    // covers running-out-fast and all-expired cases. See T164.
    const routine = { ...baseRoutine, stock: 7, stock_name: 'Ibuprofen', stock_quantity: 0, stock_usage: 1 }
    renderCard(routine, { queryClient: clientWithStock({ id: 7, stock_severity: 'critical' }) })
    expect(screen.getByTestId('stock-icon').getAttribute('class')).toContain('iconDanger')
  })

  it('tints the stock icon amber when the cached stock_severity is low', () => {
    const routine = { ...baseRoutine, stock: 7, stock_name: 'Filters', stock_quantity: 2, stock_usage: 1 }
    renderCard(routine, { queryClient: clientWithStock({ id: 7, stock_severity: 'low' }) })
    expect(screen.getByTestId('stock-icon').getAttribute('class')).toContain('iconWarning')
  })

  it('tints the stock icon green when the cached stock_severity is ok', () => {
    const routine = { ...baseRoutine, stock: 7, stock_name: 'Filters', stock_quantity: 5, stock_usage: 1 }
    renderCard(routine, { queryClient: clientWithStock({ id: 7, stock_severity: 'ok' }) })
    expect(screen.getByTestId('stock-icon').getAttribute('class')).toContain('iconSuccess')
  })

  // T165: documents the no-worst-of-two contract — `iconClassForStock` looks
  // only at `stock_severity`. Even a soon/reached lot expiry never bubbles
  // into the routine card's stock badge tint.
  it('iconClassForStock ignores expiry_severity=soon when stock_severity is ok', () => {
    const routine = { ...baseRoutine, stock: 7, stock_name: 'Filters', stock_quantity: 5, stock_usage: 1 }
    renderCard(routine, { queryClient: clientWithStock({ id: 7, stock_severity: 'ok', expiry_severity: 'soon' }) })
    expect(screen.getByTestId('stock-icon').getAttribute('class')).toContain('iconSuccess')
  })

  it('leaves the stock icon untinted when the stock cache is cold', () => {
    renderCard({ ...baseRoutine, stock: 7, stock_name: 'Filters', stock_quantity: 5, stock_usage: 1 })
    const cls = screen.getByTestId('stock-icon').getAttribute('class') ?? ''
    expect(cls).not.toContain('iconDanger')
    expect(cls).not.toContain('iconWarning')
    expect(cls).not.toContain('iconSuccess')
  })
})
