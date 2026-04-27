import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import HistoryEntryCard from '../HistoryEntryCard'

function routineEntry(overrides = {}) {
  return {
    _type: 'routine',
    id: 1,
    routine_name: 'Vitamins',
    created_at: '2026-04-20T08:00:00Z',
    notes: null,
    consumed_lots: [],
    ...overrides,
  }
}

function consumptionEntry(overrides = {}) {
  return {
    _type: 'consumption',
    id: 2,
    stock_name: 'Ibuprofen',
    quantity: 1,
    created_at: '2026-04-20T08:30:00Z',
    notes: null,
    consumed_lots: [],
    ...overrides,
  }
}

describe('HistoryEntryCard — compact', () => {
  it('renders the lot numbers inline when consumed lots expose them', () => {
    renderWithProviders(
      <HistoryEntryCard
        entry={consumptionEntry({
          consumed_lots: [{ quantity: 1, lot_number: 'LOT-A' }],
          stock_name: 'Soap',
        })}
        compact
      />,
    )
    expect(screen.getByText('(LOT-A)')).toBeInTheDocument()
    expect(screen.getByText('−1')).toBeInTheDocument()
  })

  it('shows an author line when completed_by_username is set on a routine', () => {
    renderWithProviders(<HistoryEntryCard entry={routineEntry({ completed_by_username: 'alice' })} compact />)
    expect(screen.getByText(/alice/)).toBeInTheDocument()
  })
})

describe('HistoryEntryCard — full card', () => {
  it('renders a read-only notes view when editable callbacks are not wired', () => {
    renderWithProviders(<HistoryEntryCard entry={routineEntry({ notes: 'After breakfast' })} />)
    expect(screen.getByText('After breakfast')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit|add/i })).not.toBeInTheDocument()
  })

  it('exposes an editable notes view and calls onStartEdit when clicked', async () => {
    const onStartEdit = vi.fn()
    const { user } = renderWithProviders(
      <HistoryEntryCard
        entry={routineEntry({ notes: 'After breakfast' })}
        onStartEdit={onStartEdit}
        onSave={vi.fn()}
      />,
    )
    await user.click(screen.getByText('After breakfast'))
    expect(onStartEdit).toHaveBeenCalledTimes(1)
  })

  it('renders the edit input and fires onSave on Enter', async () => {
    const onSave = vi.fn()
    const { user } = renderWithProviders(
      <HistoryEntryCard
        entry={routineEntry({ notes: '' })}
        isEditing
        onStartEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onSave={onSave}
      />,
    )
    const input = screen.getByPlaceholderText(/add a note/i)
    await user.type(input, 'Done early{Enter}')
    expect(onSave).toHaveBeenCalledWith('Done early')
  })

  it('fires onCancelEdit on Escape', async () => {
    const onCancelEdit = vi.fn()
    const { user } = renderWithProviders(
      <HistoryEntryCard
        entry={routineEntry({ notes: '' })}
        isEditing
        onStartEdit={vi.fn()}
        onCancelEdit={onCancelEdit}
        onSave={vi.fn()}
      />,
    )
    const input = screen.getByPlaceholderText(/add a note/i)
    await user.type(input, 'x{Escape}')
    expect(onCancelEdit).toHaveBeenCalled()
  })

  it('renders consumed-lots summary with lot numbers for a consumption entry', () => {
    renderWithProviders(
      <HistoryEntryCard
        entry={consumptionEntry({
          consumed_lots: [
            { quantity: 2, lot_number: 'LOT-A' },
            { quantity: 1, lot_number: 'LOT-B' },
          ],
          stock_name: 'Soap',
        })}
      />,
    )
    expect(screen.getByText(/LOT-A, LOT-B/)).toBeInTheDocument()
    expect(screen.getAllByText(/Soap/).length).toBeGreaterThanOrEqual(1)
  })
})
