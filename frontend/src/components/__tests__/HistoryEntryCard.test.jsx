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
    client_created_at: null,
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
    client_created_at: null,
    notes: null,
    consumed_lots: [],
    ...overrides,
  }
}

describe('HistoryEntryCard — consumed lots, expanded', () => {
  const expanded = (consumed_lots) =>
    renderWithProviders(<HistoryEntryCard entry={consumptionEntry({ consumed_lots, stock_name: 'Soap' })} />)

  it('labels the lot and the serial on their own lines', () => {
    expanded([{ quantity: 1, lot_number: 'LOT-A', serial_number: 'SN-1' }])

    expect(screen.getByText('Batch ID')).toBeInTheDocument()
    expect(screen.getByText('LOT-A')).toBeInTheDocument()
    expect(screen.getByText('Serial')).toBeInTheDocument()
    expect(screen.getByText('SN-1')).toBeInTheDocument()
  })

  it('omits the serial line entirely when the pack has none', () => {
    expanded([{ quantity: 1, lot_number: 'LOT-A', serial_number: null }])

    expect(screen.getByText('LOT-A')).toBeInTheDocument()
    // Not an empty label: the whole line is absent.
    expect(screen.queryByText('Serial')).not.toBeInTheDocument()
  })

  it('treats a pre-serial snapshot with no serial_number key like one with none', () => {
    // Snapshots written before serials existed have no such key at all — see
    // `Stock.consume_lots`. The seeder ships one (MET-OLD).
    expanded([{ quantity: 2, lot_number: 'OLD' }])

    expect(screen.getByText('OLD')).toBeInTheDocument()
    expect(screen.queryByText('Serial')).not.toBeInTheDocument()
  })

  it('renders one block per consumed lot, repeating the lot label', () => {
    // Two boxes of the same batch are two blocks: literal to the snapshot,
    // deliberately not grouped.
    expanded([
      { quantity: 1, lot_number: 'MET-A', serial_number: 'SN-1' },
      { quantity: 1, lot_number: 'MET-A', serial_number: 'SN-2' },
    ])

    expect(screen.getAllByText('Batch ID')).toHaveLength(2)
    expect(screen.getAllByText('Serial')).toHaveLength(2)
    expect(screen.getByText('SN-1')).toBeInTheDocument()
    expect(screen.getByText('SN-2')).toBeInTheDocument()
  })

  it('renders no lot block at all when the entry consumed nothing', () => {
    expanded([])

    expect(screen.queryByText('Batch ID')).not.toBeInTheDocument()
  })
})

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
    expect(screen.getByText('(LOT LOT-A)')).toBeInTheDocument()
    expect(screen.getByText('−1')).toBeInTheDocument()
  })

  it('shows the serial of a consumed pack alongside its lot number', () => {
    renderWithProviders(
      <HistoryEntryCard
        entry={consumptionEntry({
          consumed_lots: [{ quantity: 1, lot_number: 'LOT-A', serial_number: 'SN-1' }],
          stock_name: 'Soap',
        })}
        compact
      />,
    )
    expect(screen.getByText('(LOT LOT-A · SN SN-1)')).toBeInTheDocument()
  })

  it('shows the serial alone when the pack has no lot number', () => {
    renderWithProviders(
      <HistoryEntryCard
        entry={consumptionEntry({
          consumed_lots: [{ quantity: 1, lot_number: null, serial_number: 'SN-7' }],
          stock_name: 'Soap',
        })}
        compact
      />,
    )
    expect(screen.getByText('(SN SN-7)')).toBeInTheDocument()
  })

  it('renders a pre-serial snapshot that has no serial_number key', () => {
    renderWithProviders(
      <HistoryEntryCard
        entry={consumptionEntry({
          consumed_lots: [{ quantity: 2, lot_number: 'OLD' }],
          stock_name: 'Soap',
        })}
        compact
      />,
    )
    expect(screen.getByText('(LOT OLD)')).toBeInTheDocument()
  })

  it('shows the author when the entry was logged by a different user', () => {
    renderWithProviders(
      <HistoryEntryCard entry={routineEntry({ completed_by_id: 99, completed_by_display_name: 'Alice' })} compact />,
    )
    expect(screen.getByText(/Alice/)).toBeInTheDocument()
  })

  it('hides the author when the entry was logged by the current user', () => {
    // Default `user` in renderWithProviders has id=1; matching id hides the chip.
    renderWithProviders(
      <HistoryEntryCard entry={routineEntry({ completed_by_id: 1, completed_by_display_name: 'Test User' })} compact />,
    )
    expect(screen.queryByText(/Test User/)).not.toBeInTheDocument()
  })
})

describe('HistoryEntryCard — full card', () => {
  it('shows the author when the entry was logged by a different user', () => {
    renderWithProviders(
      <HistoryEntryCard entry={routineEntry({ completed_by_id: 99, completed_by_display_name: 'Alice' })} />,
    )
    expect(screen.getByText(/Alice/)).toBeInTheDocument()
  })

  it('hides the author when the entry was logged by the current user', () => {
    renderWithProviders(
      <HistoryEntryCard entry={routineEntry({ completed_by_id: 1, completed_by_display_name: 'Test User' })} />,
    )
    expect(screen.queryByText(/Test User/)).not.toBeInTheDocument()
  })

  it('renders a read-only notes view when editable callbacks are not wired', () => {
    renderWithProviders(<HistoryEntryCard entry={routineEntry({ notes: 'After breakfast' })} />)
    expect(screen.getByText('After breakfast')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit|add/i })).not.toBeInTheDocument()
  })

  it('leaves the note as plain text, with no hidden click target', async () => {
    // Previously the text itself was a button. Creating and editing both go
    // through a visible control now, so clicking the words must do nothing.
    const onStartEdit = vi.fn()
    const { user } = renderWithProviders(
      <HistoryEntryCard
        entry={routineEntry({ notes: 'After breakfast' })}
        onStartEdit={onStartEdit}
        onSave={vi.fn()}
      />,
    )

    const note = screen.getByText('After breakfast')
    expect(note.tagName).not.toBe('BUTTON')
    await user.click(note)
    expect(onStartEdit).not.toHaveBeenCalled()
  })

  it('puts the pencil beside the note and starts editing from it', async () => {
    const onStartEdit = vi.fn()
    const { user } = renderWithProviders(
      <HistoryEntryCard
        entry={routineEntry({ notes: 'After breakfast' })}
        onStartEdit={onStartEdit}
        onSave={vi.fn()}
      />,
    )

    await user.click(screen.getByTestId('edit-note'))
    expect(onStartEdit).toHaveBeenCalledTimes(1)
  })

  it('shows exactly one edit affordance: the pencil replaces the header button', async () => {
    renderWithProviders(
      <HistoryEntryCard entry={routineEntry({ notes: 'After breakfast' })} onStartEdit={vi.fn()} onSave={vi.fn()} />,
    )

    expect(screen.getByTestId('edit-note')).toBeInTheDocument()
    expect(screen.queryByTestId('add-note')).not.toBeInTheDocument()
  })

  it('offers the add button in the header when there is no note at all', () => {
    renderWithProviders(
      <HistoryEntryCard entry={routineEntry({ notes: null })} onStartEdit={vi.fn()} onSave={vi.fn()} />,
    )

    expect(screen.getByTestId('add-note')).toBeInTheDocument()
    // No note, no notes row — the card keeps its constant header height.
    expect(screen.queryByTestId('edit-note')).not.toBeInTheDocument()
  })

  it('offers no edit control at all when the callbacks are not wired', () => {
    renderWithProviders(<HistoryEntryCard entry={routineEntry({ notes: 'After breakfast' })} />)

    expect(screen.getByText('After breakfast')).toBeInTheDocument()
    expect(screen.queryByTestId('edit-note')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-note')).not.toBeInTheDocument()
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

  const editing = (props = {}) =>
    renderWithProviders(
      <HistoryEntryCard
        entry={routineEntry({ notes: props.notes ?? '' })}
        isEditing
        onStartEdit={vi.fn()}
        onCancelEdit={props.onCancelEdit ?? vi.fn()}
        onSave={props.onSave ?? vi.fn()}
      />,
    )

  it('saves what was typed when the save button is pressed', async () => {
    const onSave = vi.fn()
    const { user } = editing({ onSave })

    await user.type(screen.getByTestId('note-input'), 'Done early')
    await user.click(screen.getByTestId('save-note'))

    expect(onSave).toHaveBeenCalledWith('Done early')
  })

  it('saves from the button even though clicking it blurs the input', async () => {
    // The sharpest edge in this flow: the click blurs the field first. If that
    // path were treated as clicking away, saving would prompt to discard.
    const onSave = vi.fn()
    const onCancelEdit = vi.fn()
    const { user } = editing({ onSave, onCancelEdit })

    await user.type(screen.getByTestId('note-input'), 'Done early')
    await user.click(screen.getByTestId('save-note'))

    expect(onSave).toHaveBeenCalledWith('Done early')
    expect(screen.queryByText(/discard/i)).not.toBeInTheDocument()
    expect(onCancelEdit).not.toHaveBeenCalled()
  })

  it('never saves on blur alone', async () => {
    // The regression this task exists for: blur used to save, which is the
    // opposite of what a button-less form promises.
    const onSave = vi.fn()
    const { user } = editing({ onSave })

    const input = screen.getByTestId('note-input')
    await user.type(input, 'typed but abandoned')
    input.blur()

    expect(onSave).not.toHaveBeenCalled()
  })

  it('closes without a prompt when Escape is pressed and nothing changed', async () => {
    const onCancelEdit = vi.fn()
    const { user } = editing({ notes: 'Original', onCancelEdit })

    await user.keyboard('{Escape}')

    expect(onCancelEdit).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/discard/i)).not.toBeInTheDocument()
  })

  it('asks before throwing away a changed note on Escape', async () => {
    const onCancelEdit = vi.fn()
    const { user } = editing({ notes: 'Original', onCancelEdit })

    await user.type(screen.getByTestId('note-input'), ' plus more')
    await user.keyboard('{Escape}')

    expect(await screen.findByText(/discard the changes/i)).toBeInTheDocument()
    // Nothing is lost until the user says so.
    expect(onCancelEdit).not.toHaveBeenCalled()
  })

  it('discards only after the confirmation is accepted', async () => {
    const onCancelEdit = vi.fn()
    const { user } = editing({ notes: 'Original', onCancelEdit })

    await user.type(screen.getByTestId('note-input'), ' plus more')
    await user.keyboard('{Escape}')
    await user.click(await screen.findByRole('button', { name: /^discard$/i }))

    expect(onCancelEdit).toHaveBeenCalledTimes(1)
  })

  it('keeps the editor and the text when the confirmation is dismissed', async () => {
    const onCancelEdit = vi.fn()
    const { user } = editing({ notes: 'Original', onCancelEdit })

    await user.type(screen.getByTestId('note-input'), ' plus more')
    await user.keyboard('{Escape}')
    await user.click(await screen.findByRole('button', { name: /cancel/i }))

    expect(onCancelEdit).not.toHaveBeenCalled()
    expect(screen.getByTestId('note-input')).toHaveValue('Original plus more')
  })

  it('asks before discarding when the user clicks away with changes', async () => {
    const onCancelEdit = vi.fn()
    const { user } = editing({ notes: 'Original', onCancelEdit })

    await user.type(screen.getByTestId('note-input'), ' plus more')
    await user.click(document.body)

    expect(await screen.findByText(/discard the changes/i)).toBeInTheDocument()
    expect(onCancelEdit).not.toHaveBeenCalled()
  })

  it('closes silently when the user clicks away without typing', async () => {
    const onCancelEdit = vi.fn()
    const { user } = editing({ notes: 'Original', onCancelEdit })

    await user.click(document.body)

    expect(onCancelEdit).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/discard/i)).not.toBeInTheDocument()
  })

  it('renders one labelled block per consumed lot, with the summed quantity in the badge', () => {
    // Previously the expanded card flattened every lot into "LOT-A, LOT-B".
    // Each lot now gets its own labelled block, so the two values are separate
    // elements rather than one string.
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
    expect(screen.getByText('LOT-A')).toBeInTheDocument()
    expect(screen.getByText('LOT-B')).toBeInTheDocument()
    expect(screen.getAllByText('Batch ID')).toHaveLength(2)
    // A consumption is titled by its stock, so the badge shows the quantity
    // alone rather than repeating the name.
    expect(screen.getByTestId('entry-stock-badge')).toHaveTextContent('3 u.')
  })

  it('does not repeat the stock name when the title already carries it', () => {
    renderWithProviders(
      <HistoryEntryCard
        entry={consumptionEntry({
          consumed_lots: [{ quantity: 2, lot_number: 'LOT-A' }],
          stock_name: 'Soap',
        })}
      />,
    )

    // "Soap" is the card title; the badge must not say it again.
    expect(screen.getAllByText('Soap')).toHaveLength(1)
    expect(screen.getByTestId('entry-stock-badge')).toHaveTextContent('2 u.')
  })

  it('keeps the stock name on a routine entry, where it is new information', () => {
    // "Take antihistamine" is the title; the stock it consumed is a different
    // thing and has to be named.
    renderWithProviders(
      <HistoryEntryCard
        entry={routineEntry({
          routine_name: 'Take antihistamine',
          consumed_lots: [{ quantity: 1, lot_number: 'EBA-1' }],
          stock_name: 'Ebastine',
        })}
      />,
    )

    // The name sits in its own element for styling, so assert across children.
    expect(screen.getByTestId('entry-stock-badge')).toHaveTextContent('1 × Ebastine')
  })

  it('names the stock again when the title is hidden', () => {
    // With no title there is nothing to duplicate, so the name comes back.
    renderWithProviders(
      <HistoryEntryCard
        entry={consumptionEntry({
          consumed_lots: [{ quantity: 2, lot_number: 'LOT-A' }],
          stock_name: 'Soap',
        })}
        showTitle={false}
      />,
    )

    expect(screen.getByTestId('entry-stock-badge')).toHaveTextContent('2 × Soap')
  })
})
