import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import RoutineCard from '../RoutineCard'

const baseRoutine = {
  id: 1,
  name: 'Take vitamins',
  next_due_at: new Date(Date.now() + 3600000).toISOString(),
  created_at: '2025-01-15T10:00:00Z',
  is_due: true,
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
    const routine = { ...baseRoutine, is_due: true, hours_until_due: -2 }
    const { container } = renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    const row = container.firstChild
    expect(row.className).toContain('borderDanger')
  })

  it('applies warning border class when due but hours_until_due is between -1 and 0', () => {
    const routine = { ...baseRoutine, is_due: true, hours_until_due: -0.5 }
    const { container } = renderWithProviders(<RoutineCard routine={routine} onMarkDone={vi.fn()} completing={false} />)
    const row = container.firstChild
    expect(row.className).toContain('borderWarning')
  })
})
