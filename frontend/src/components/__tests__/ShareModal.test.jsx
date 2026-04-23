import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import ShareModal from '../ShareModal'

const contacts = [
  { id: 10, username: 'alice' },
  { id: 11, username: 'bob' },
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

  it('renders contacts list', () => {
    renderWithProviders(<ShareModal {...defaultProps} />)
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
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
    await user.click(screen.getByText('alice'))
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
