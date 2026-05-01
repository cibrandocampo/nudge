import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '../../test/helpers'
import RoutineCard from '../RoutineCard'

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
}

describe('RoutineCard', () => {
  it('renders routine name and time', () => {
    renderWithProviders(<RoutineCard routine={baseRoutine} onMarkDone={vi.fn()} completing={false} />)
    expect(screen.getByText('Take vitamins')).toBeInTheDocument()
  })

  it('shows stock usage per execution when stock is linked', () => {
    const routine = { ...baseRoutine, stock_name: 'Filters', stock_quantity: 5, stock_usage: 2 }
    renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    expect(screen.getByText(/2 × Filters/)).toBeInTheDocument()
    expect(screen.queryByText(/5/)).not.toBeInTheDocument()
  })

  it('shows Done button only when is_due', () => {
    renderWithProviders(<RoutineCard routine={baseRoutine} onMarkDone={vi.fn()} completing={false} />)
    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument()
  })

  it('hides Done button when not is_due', () => {
    const routine = { ...baseRoutine, is_due: false }
    renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    expect(screen.queryByRole('button', { name: /done/i })).not.toBeInTheDocument()
  })

  it('calls onMarkDone with routine id when Done clicked', async () => {
    const onMarkDone = vi.fn()
    const { user } = renderWithProviders(
      <RoutineCard routine={baseRoutine} onMarkDone={onMarkDone} completing={false} />,
    )
    await user.click(screen.getByRole('button', { name: /done/i }))
    expect(onMarkDone).toHaveBeenCalledWith(1)
  })

  it('disables button when completing', () => {
    renderWithProviders(<RoutineCard routine={baseRoutine} onMarkDone={vi.fn()} completing={true} />)
    expect(screen.getByText('…')).toBeDisabled()
  })

  it('shows "Since" label when no next_due_at', () => {
    const routine = { ...baseRoutine, next_due_at: null }
    renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    expect(screen.getByText(/Since/)).toBeInTheDocument()
  })

  it('applies danger border class when overdue', () => {
    const routine = { ...baseRoutine, is_due: true, is_overdue: true }
    const { container } = renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    const card = container.firstChild
    expect(card.className).toContain('cardBorderDanger')
  })

  it('applies warning border class when due today but not yet overdue', () => {
    const routine = { ...baseRoutine, is_due: true, is_overdue: false, hours_until_due: 3 }
    const { container } = renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    const card = container.firstChild
    expect(card.className).toContain('cardBorderWarning')
  })

  it('applies success border class when not due', () => {
    const routine = { ...baseRoutine, is_due: false, is_overdue: false, hours_until_due: 24 }
    const { container } = renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    const card = container.firstChild
    expect(card.className).toContain('cardBorderSuccess')
  })

  // ── Sharing ────────────────────────────────────────────────────────────────
  // Sharing is edited from the routine form (ShareWithSection). The card
  // surfaces a passive `shared-badge` for both owner (filled variant) and
  // recipient (outlined variant). The inline owner-username label was
  // removed in T134 — the badge's `aria-label` carries the owner's name
  // for the recipient case instead.

  it('does not expose an interactive share button', () => {
    const routine = { ...baseRoutine, shared_with: [], is_owner: true, owner_username: 'testuser' }
    renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument()
  })

  it('clicking a due card row navigates to routine detail', async () => {
    const routine = { ...baseRoutine, is_due: true, is_overdue: false }
    const { user } = renderWithProviders(
      <Routes>
        <Route path="/" element={<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />} />
        <Route path="/routines/:id" element={<div>Detail page</div>} />
      </Routes>,
      { initialEntries: ['/'] },
    )
    // Click the card (not the Done button)
    const card = screen.getByText('Take vitamins').closest('[class*="card"]')
    await user.click(card)
    await waitFor(() => expect(screen.getByText('Detail page')).toBeInTheDocument())
  })

  it('renders the owner-variant badge when the user owns and has shared the routine', () => {
    const routine = { ...baseRoutine, shared_with: [10], is_owner: true }
    renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    const badge = screen.getByTestId('shared-badge')
    expect(badge).toBeInTheDocument()
    expect(badge.getAttribute('data-variant')).toBe('owner')
    expect(badge.className).toContain('btnIconShared')
    expect(badge.className).not.toContain('btnIconSharedRecipient')
  })

  it('renders the recipient-variant badge when the user is not the owner', () => {
    const routine = { ...baseRoutine, shared_with: [], is_owner: false, owner_username: 'alice' }
    renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    const badge = screen.getByTestId('shared-badge')
    expect(badge).toBeInTheDocument()
    expect(badge.getAttribute('data-variant')).toBe('recipient')
    expect(badge.className).toContain('btnIconSharedRecipient')
  })

  it('omits the badge entirely when the owner has not shared the routine', () => {
    const routine = { ...baseRoutine, shared_with: [], is_owner: true, owner_username: 'testuser' }
    renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    expect(screen.queryByTestId('shared-badge')).not.toBeInTheDocument()
  })

  it('never renders the inline owner-label, regardless of role', () => {
    for (const overrides of [
      { shared_with: [], is_owner: true, owner_username: 'testuser' },
      { shared_with: [10], is_owner: true, owner_username: 'testuser' },
      { shared_with: [], is_owner: false, owner_username: 'alice' },
    ]) {
      const { unmount } = renderWithProviders(
        <RoutineCard routine={{ ...baseRoutine, ...overrides }} onMarkDone={vi.fn()} completing={false} />,
      )
      expect(screen.queryByTestId('owner-label')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('interpolates the owner username into the recipient badge aria-label', () => {
    const routine = { ...baseRoutine, shared_with: [], is_owner: false, owner_username: 'alice' }
    renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    const badge = screen.getByTestId('shared-badge')
    expect(badge.getAttribute('aria-label')).toContain('alice')
    expect(badge.getAttribute('title')).toContain('alice')
  })

  it('disables the Done button with a tooltip when the backing stock is depleted', () => {
    const routine = {
      ...baseRoutine,
      stock_name: 'Ibuprofen',
      stock_quantity: 0,
      stock_usage: 1,
    }
    renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    const done = screen.getByRole('button', { name: /done/i })
    expect(done).toBeDisabled()
    expect(done).toHaveAttribute('title', expect.stringMatching(/no stock/i))
  })

  it('shows the interval label when provided on the routine', () => {
    const routine = { ...baseRoutine, interval_label: 'every 8 h' }
    renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    expect(screen.getByText('every 8 h')).toBeInTheDocument()
  })

  // ── Stock severity icon tint ───────────────────────────────────────────────
  // The package icon next to the linked stock takes its colour from the
  // cached stock's `stock_severity`. When the stock cache is cold (e.g. user
  // landed on the dashboard before the stock list resolved), the icon falls
  // back to the badge's default text colour and stays neutral.

  it('tints the stock icon red when the cached stock is out of stock', () => {
    const routine = { ...baseRoutine, stock: 7, stock_name: 'Ibuprofen', stock_quantity: 0, stock_usage: 1 }
    const qc = clientWithStock({ id: 7, stock_severity: 'out' })
    renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />, { queryClient: qc })
    expect(screen.getByTestId('stock-icon').getAttribute('class')).toContain('iconDanger')
  })

  it('tints the stock icon amber when the cached stock is low', () => {
    const routine = { ...baseRoutine, stock: 7, stock_name: 'Filters', stock_quantity: 2, stock_usage: 1 }
    const qc = clientWithStock({ id: 7, stock_severity: 'low' })
    renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />, { queryClient: qc })
    expect(screen.getByTestId('stock-icon').getAttribute('class')).toContain('iconWarning')
  })

  it('tints the stock icon green when the cached stock is healthy', () => {
    const routine = { ...baseRoutine, stock: 7, stock_name: 'Filters', stock_quantity: 5, stock_usage: 1 }
    const qc = clientWithStock({ id: 7, stock_severity: 'ok' })
    renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />, { queryClient: qc })
    expect(screen.getByTestId('stock-icon').getAttribute('class')).toContain('iconSuccess')
  })

  it('leaves the stock icon untinted when the stock cache is cold', () => {
    const routine = { ...baseRoutine, stock: 7, stock_name: 'Filters', stock_quantity: 5, stock_usage: 1 }
    renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    const cls = screen.getByTestId('stock-icon').getAttribute('class') ?? ''
    expect(cls).not.toContain('iconDanger')
    expect(cls).not.toContain('iconWarning')
    expect(cls).not.toContain('iconSuccess')
  })
})
