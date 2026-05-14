import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import ShareModal from '../ShareModal'

// Post-T197: ShareModal renders `fullName(contact)` — the username is
// internal-only. Test fixtures carry first_name so the visible text is
// deterministic.
const contacts = [
  { id: 10, first_name: 'Alice', email: 'alice@example.com' },
  { id: 11, first_name: 'Bob', email: 'bob@example.com' },
]

describe('ShareModal', () => {
  const defaultProps = {
    contacts,
    sharedWith: [],
    onToggle: vi.fn(),
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders contacts list using the display name', () => {
    renderWithProviders(<ShareModal {...defaultProps} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('shows selected state for shared contacts', () => {
    const { container } = renderWithProviders(<ShareModal {...defaultProps} sharedWith={[10]} />)
    const items = container.querySelectorAll('li')
    expect(items[0].className).toContain('itemSelected')
    expect(items[1].className).not.toContain('itemSelected')
  })

  it('calls onToggle with contact id when item clicked', async () => {
    const onToggle = vi.fn()
    const { user } = renderWithProviders(<ShareModal {...defaultProps} onToggle={onToggle} />)
    await user.click(screen.getByText('Alice'))
    expect(onToggle).toHaveBeenCalledWith(10)
  })

  it('calls onClose when cancel button clicked', async () => {
    const onClose = vi.fn()
    const { user } = renderWithProviders(<ShareModal {...defaultProps} onClose={onClose} />)
    await user.click(screen.getByRole('button'))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when overlay clicked', () => {
    const onClose = vi.fn()
    renderWithProviders(<ShareModal {...defaultProps} onClose={onClose} />)
    fireEvent.click(screen.getByRole('dialog').parentElement)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not close when modal box clicked', () => {
    const onClose = vi.fn()
    renderWithProviders(<ShareModal {...defaultProps} onClose={onClose} />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn()
    renderWithProviders(<ShareModal {...defaultProps} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('handles empty sharedWith gracefully', () => {
    const { container } = renderWithProviders(<ShareModal {...defaultProps} sharedWith={undefined} />)
    const items = container.querySelectorAll('li')
    items.forEach((item) => expect(item.className).not.toContain('itemSelected'))
  })
})
