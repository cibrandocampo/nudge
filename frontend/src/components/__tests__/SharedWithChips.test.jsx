import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SharedWithChips from '../SharedWithChips'

const contacts = [
  { id: 1, username: 'maria', first_name: 'María', last_name: 'González' },
  { id: 2, username: 'admin' },
]

describe('SharedWithChips', () => {
  it('renders only the username in read-only mode (no onRemove)', () => {
    render(<SharedWithChips contacts={contacts} />)
    // Read-only: just the username, no full name + parenthesised username.
    expect(screen.getByText('maria')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.queryByText('María González (maria)')).not.toBeInTheDocument()
  })

  it('renders the full display label in editable mode (with onRemove)', () => {
    render(<SharedWithChips contacts={contacts} onRemove={vi.fn()} />)
    expect(screen.getByText('María González (maria)')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
  })

  it('does NOT render a remove button when onRemove is not provided (read-only mode)', () => {
    render(<SharedWithChips contacts={contacts} />)
    expect(screen.queryByLabelText(/Unshare with/)).not.toBeInTheDocument()
  })

  it('renders a remove button per chip when onRemove is provided', () => {
    const onRemove = vi.fn()
    render(<SharedWithChips contacts={contacts} onRemove={onRemove} />)
    expect(screen.getByLabelText('Unshare with maria')).toBeInTheDocument()
    expect(screen.getByLabelText('Unshare with admin')).toBeInTheDocument()
  })

  it('calls onRemove with the contact id when the remove button is clicked', async () => {
    const onRemove = vi.fn()
    const user = userEvent.setup()
    render(<SharedWithChips contacts={contacts} onRemove={onRemove} />)
    await user.click(screen.getByLabelText('Unshare with maria'))
    expect(onRemove).toHaveBeenCalledWith(1)
  })

  it('returns null for an empty contacts array', () => {
    const { container } = render(<SharedWithChips contacts={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the avatar initial uppercased from first_name when present', () => {
    render(<SharedWithChips contacts={[contacts[0]]} />)
    // first_name "María" → "M"
    expect(screen.getByText('M')).toBeInTheDocument()
  })

  it('falls back to the username initial when first_name is absent', () => {
    render(<SharedWithChips contacts={[contacts[1]]} />)
    // username "admin" → "A"
    expect(screen.getByText('A')).toBeInTheDocument()
  })
})
