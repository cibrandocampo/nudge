import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ConflictModal from '../ConflictModal'

const mutation = {
  id: 'k-1',
  method: 'PATCH',
  endpoint: '/routines/5/',
  body: { name: 'Coco', description: 'same' },
  conflictCurrent: { id: 5, name: 'Max', description: 'same', updated_at: '2026-04-17T09:15:00Z' },
  resourceKey: 'routine:5',
}

describe('ConflictModal', () => {
  it('renders a diff row per field that differs, with both values', () => {
    render(<ConflictModal mutation={mutation} onKeepMine={vi.fn()} onUseServer={vi.fn()} onClose={vi.fn()} />)
    const yours = screen.getAllByTestId('conflict-yours')
    const theirs = screen.getAllByTestId('conflict-server')

    // Only `name` differs between local and server — `description` matches
    // and `id`/`updated_at` are server-only fields that should be skipped.
    expect(yours).toHaveLength(1)
    expect(theirs).toHaveLength(1)
    expect(yours[0]).toHaveTextContent('Coco')
    expect(theirs[0]).toHaveTextContent('Max')
    expect(screen.getByText(/Name/i)).toBeInTheDocument()
  })

  it('renders a dialog with aria-modal', () => {
    render(<ConflictModal mutation={mutation} onKeepMine={vi.fn()} onUseServer={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })

  it('shows a "no differences" message when payloads match', () => {
    const identical = {
      ...mutation,
      body: { name: 'X' },
      conflictCurrent: { name: 'X' },
    }
    render(<ConflictModal mutation={identical} onKeepMine={vi.fn()} onUseServer={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryAllByTestId('conflict-yours')).toHaveLength(0)
    expect(screen.getByText(/No field differences detected/i)).toBeInTheDocument()
  })

  it('calls onKeepMine when the primary button is pressed', async () => {
    const onKeepMine = vi.fn()
    const user = userEvent.setup()
    render(<ConflictModal mutation={mutation} onKeepMine={onKeepMine} onUseServer={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Overwrite with my version/i }))
    expect(onKeepMine).toHaveBeenCalledTimes(1)
  })

  it('calls onUseServer when the secondary button is pressed', async () => {
    const onUseServer = vi.fn()
    const user = userEvent.setup()
    render(<ConflictModal mutation={mutation} onKeepMine={vi.fn()} onUseServer={onUseServer} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Discard my changes/i }))
    expect(onUseServer).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the × button is pressed', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<ConflictModal mutation={mutation} onKeepMine={vi.fn()} onUseServer={vi.fn()} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders array values inline (e.g. shared_with)', () => {
    const arrMutation = {
      body: { shared_with: [2, 3] },
      conflictCurrent: { shared_with: [2] },
    }
    render(<ConflictModal mutation={arrMutation} onKeepMine={vi.fn()} onUseServer={vi.fn()} onClose={vi.fn()} />)
    const yours = screen.getByTestId('conflict-yours')
    const theirs = screen.getByTestId('conflict-server')
    expect(within(yours).getByText('[2,3]')).toBeInTheDocument()
    expect(within(theirs).getByText('[2]')).toBeInTheDocument()
  })

  it('renders nested object values as k:v previews (formatValue object branch)', () => {
    const objMutation = {
      body: { metadata: { a: 1, b: 'x' } },
      conflictCurrent: { metadata: { a: 2, b: 'x' } },
    }
    render(<ConflictModal mutation={objMutation} onKeepMine={vi.fn()} onUseServer={vi.fn()} onClose={vi.fn()} />)
    const yours = screen.getByTestId('conflict-yours')
    const theirs = screen.getByTestId('conflict-server')
    expect(within(yours).getByText('{ a: 1, b: x }')).toBeInTheDocument()
    expect(within(theirs).getByText('{ a: 2, b: x }')).toBeInTheDocument()
  })

  it('renders booleans and numbers via String() (formatValue number/boolean branch)', () => {
    const mut = {
      body: { is_active: true, count: 3 },
      conflictCurrent: { is_active: false, count: 5 },
    }
    render(<ConflictModal mutation={mut} onKeepMine={vi.fn()} onUseServer={vi.fn()} onClose={vi.fn()} />)
    // Both fields differ → two yours cells. Match substrings since the
    // cell includes a visually-hidden "Your version" label.
    const yoursCells = screen.getAllByTestId('conflict-yours')
    const joined = yoursCells.map((c) => c.textContent).join('|')
    expect(joined).toContain('true')
    expect(joined).toContain('3')
  })

  it('renders null/undefined as an em dash (formatValue null branch)', () => {
    const mut = {
      body: { description: 'note' },
      conflictCurrent: { description: null },
    }
    render(<ConflictModal mutation={mut} onKeepMine={vi.fn()} onUseServer={vi.fn()} onClose={vi.fn()} />)
    const theirs = screen.getByTestId('conflict-server')
    expect(within(theirs).getByText('—')).toBeInTheDocument()
  })
})
