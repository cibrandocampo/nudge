import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SharedWithChips from '../SharedWithChips'

// Post-T197: chips render `displayLabel(contact)` in both read-only
// and editable modes — username is internal-only and never user-facing.
const contacts = [
  { id: 1, first_name: 'María', last_name: 'González', email: 'maria@example.com' },
  { id: 2, first_name: '', last_name: '', email: 'admin@example.com' },
]

describe('SharedWithChips', () => {
  it('renders the display label for each contact in read-only mode', () => {
    render(<SharedWithChips contacts={contacts} />)
    expect(screen.getByText('María González')).toBeInTheDocument()
    expect(screen.getByText('admin@example.com')).toBeInTheDocument()
  })

  it('renders the display label for each contact in editable mode (with onRemove)', () => {
    render(<SharedWithChips contacts={contacts} onRemove={vi.fn()} />)
    expect(screen.getByText('María González')).toBeInTheDocument()
    expect(screen.getByText('admin@example.com')).toBeInTheDocument()
  })

  it('does NOT render a remove button when onRemove is not provided (read-only mode)', () => {
    render(<SharedWithChips contacts={contacts} />)
    expect(screen.queryByLabelText(/Unshare with/)).not.toBeInTheDocument()
  })

  it('renders a remove button per chip, aria-labelled with the display name', () => {
    const onRemove = vi.fn()
    render(<SharedWithChips contacts={contacts} onRemove={onRemove} />)
    expect(screen.getByLabelText('Unshare with María González')).toBeInTheDocument()
    expect(screen.getByLabelText('Unshare with admin@example.com')).toBeInTheDocument()
  })

  it('calls onRemove with the contact id when the remove button is clicked', async () => {
    const onRemove = vi.fn()
    const user = userEvent.setup()
    render(<SharedWithChips contacts={contacts} onRemove={onRemove} />)
    await user.click(screen.getByLabelText('Unshare with María González'))
    expect(onRemove).toHaveBeenCalledWith(1)
  })

  it('returns null for an empty contacts array', () => {
    const { container } = render(<SharedWithChips contacts={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the avatar initial uppercased from first_name when present', () => {
    render(<SharedWithChips contacts={[contacts[0]]} />)
    expect(screen.getByText('M')).toBeInTheDocument()
  })

  it('falls back to the email initial when first_name is absent', () => {
    render(<SharedWithChips contacts={[contacts[1]]} />)
    expect(screen.getByText('A')).toBeInTheDocument()
  })
})
