import { screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '../../test/helpers'
import RoutineCard from '../RoutineCard'

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

  it('shows stock info when present', () => {
    const routine = { ...baseRoutine, stock_name: 'Filters', stock_quantity: 5 }
    renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    expect(screen.getByText(/Stock:/)).toBeInTheDocument()
    expect(screen.getByText(/5/)).toBeInTheDocument()
  })

  it('shows Done button only when is_due', () => {
    renderWithProviders(<RoutineCard routine={baseRoutine} onMarkDone={vi.fn()} completing={false} />)
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('hides Done button when not is_due', () => {
    const routine = { ...baseRoutine, is_due: false }
    renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    expect(screen.queryByText('Done')).not.toBeInTheDocument()
  })

  it('calls onMarkDone with routine id when Done clicked', async () => {
    const onMarkDone = vi.fn()
    const { user } = renderWithProviders(
      <RoutineCard routine={baseRoutine} onMarkDone={onMarkDone} completing={false} />,
    )
    await user.click(screen.getByText('Done'))
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
    const row = container.firstChild
    expect(row.className).toContain('borderDanger')
  })

  it('applies warning border class when due today but not yet overdue', () => {
    const routine = { ...baseRoutine, is_due: true, is_overdue: false, hours_until_due: 3 }
    const { container } = renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    const row = container.firstChild
    expect(row.className).toContain('borderWarning')
  })

  it('applies success border class when not due', () => {
    const routine = { ...baseRoutine, is_due: false, is_overdue: false, hours_until_due: 24 }
    const { container } = renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    const row = container.firstChild
    expect(row.className).toContain('borderSuccess')
  })

  // ── Sharing ────────────────────────────────────────────────────────────────

  it('shows share button when owner with contacts', () => {
    const routine = { ...baseRoutine, shared_with: [], is_owner: true, owner_username: 'testuser' }
    const contacts = [{ id: 10, username: 'alice' }]
    renderWithProviders(
      <RoutineCard
        routine={routine}
        onMarkDone={vi.fn()}
        completing={false}
        contacts={contacts}
        onToggleShare={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Share')).toBeInTheDocument()
  })

  it('hides share button when not owner', () => {
    const routine = { ...baseRoutine, shared_with: [], is_owner: false, owner_username: 'other' }
    const contacts = [{ id: 10, username: 'alice' }]
    renderWithProviders(
      <RoutineCard
        routine={routine}
        onMarkDone={vi.fn()}
        completing={false}
        contacts={contacts}
        onToggleShare={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Share')).not.toBeInTheDocument()
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
    const card = screen.getByText('Take vitamins').closest('[class*="row"]')
    await user.click(card)
    await waitFor(() => expect(screen.getByText('Detail page')).toBeInTheDocument())
  })

  it('calls onShare with routine id when share button clicked on due routine', async () => {
    const onShare = vi.fn()
    const routine = {
      ...baseRoutine,
      is_due: true,
      is_overdue: true,
      shared_with: [],
      is_owner: true,
      owner_username: 'testuser',
    }
    const contacts = [{ id: 10, username: 'alice' }]
    const { user } = renderWithProviders(
      <RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} contacts={contacts} onShare={onShare} />,
    )
    await user.click(screen.getByLabelText('Share'))
    expect(onShare).toHaveBeenCalledWith(1)
  })

  it('calls onShare with routine id when share button clicked on not-due routine', async () => {
    const onShare = vi.fn()
    const routine = {
      ...baseRoutine,
      is_due: false,
      is_overdue: false,
      shared_with: [],
      is_owner: true,
      owner_username: 'testuser',
    }
    const contacts = [{ id: 10, username: 'alice' }]
    const { user } = renderWithProviders(
      <RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} contacts={contacts} onShare={onShare} />,
    )
    await user.click(screen.getByLabelText('Share'))
    expect(onShare).toHaveBeenCalledWith(1)
  })

  it('shows owner label when not owner', () => {
    const routine = { ...baseRoutine, shared_with: [], is_owner: false, owner_username: 'other' }
    renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    expect(screen.getByText('other')).toBeInTheDocument()
  })

  it('shows shareBtnActive class on due routine when already shared', () => {
    const routine = { ...baseRoutine, is_due: true, is_overdue: true, shared_with: [10], is_owner: true }
    const contacts = [{ id: 10, username: 'alice' }]
    const { container } = renderWithProviders(
      <RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} contacts={contacts} onShare={vi.fn()} />,
    )
    expect(container.querySelector('[aria-label="Share"]').className).toContain('shareBtnActive')
  })

  it('shows shareBtnActive class on non-due routine when already shared', () => {
    const routine = { ...baseRoutine, is_due: false, is_overdue: false, shared_with: [10], is_owner: true }
    const contacts = [{ id: 10, username: 'alice' }]
    const { container } = renderWithProviders(
      <RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} contacts={contacts} onShare={vi.fn()} />,
    )
    expect(container.querySelector('[aria-label="Share"]').className).toContain('shareBtnActive')
  })
})
