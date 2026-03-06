import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import SharePopover from '../SharePopover'

const contacts = [
  { id: 10, username: 'alice' },
  { id: 11, username: 'bob' },
]

describe('SharePopover', () => {
  it('does not render when not owner', () => {
    const { container } = renderWithProviders(
      <SharePopover sharedWith={[]} contacts={contacts} isOwner={false} onToggleShare={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('does not render when no contacts', () => {
    const { container } = renderWithProviders(
      <SharePopover sharedWith={[]} contacts={[]} isOwner={true} onToggleShare={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders emoji button', () => {
    renderWithProviders(<SharePopover sharedWith={[]} contacts={contacts} isOwner={true} onToggleShare={vi.fn()} />)
    expect(screen.getByLabelText('Share')).toBeInTheDocument()
  })

  it('shows active state when shared with someone', () => {
    renderWithProviders(<SharePopover sharedWith={[10]} contacts={contacts} isOwner={true} onToggleShare={vi.fn()} />)
    const btn = screen.getByLabelText('Share')
    expect(btn.className).toContain('shareBtnActive')
  })

  it('opens popover on click with checkboxes for each contact', async () => {
    const { user } = renderWithProviders(
      <SharePopover sharedWith={[]} contacts={contacts} isOwner={true} onToggleShare={vi.fn()} />,
    )
    await user.click(screen.getByLabelText('Share'))
    expect(screen.getByTestId('share-popover')).toBeInTheDocument()
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
  })

  it('shows checked state for shared contacts', async () => {
    const { user } = renderWithProviders(
      <SharePopover sharedWith={[10]} contacts={contacts} isOwner={true} onToggleShare={vi.fn()} />,
    )
    await user.click(screen.getByLabelText('Share'))
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes[0]).toBeChecked()
    expect(checkboxes[1]).not.toBeChecked()
  })

  it('calls onToggleShare with correct userId on checkbox click', async () => {
    const onToggle = vi.fn()
    const { user } = renderWithProviders(
      <SharePopover sharedWith={[]} contacts={contacts} isOwner={true} onToggleShare={onToggle} />,
    )
    await user.click(screen.getByLabelText('Share'))
    await user.click(screen.getAllByRole('checkbox')[0])
    expect(onToggle).toHaveBeenCalledWith(10)
  })

  it('closes on outside click', async () => {
    const { user } = renderWithProviders(
      <div>
        <span data-testid="outside">outside</span>
        <SharePopover sharedWith={[]} contacts={contacts} isOwner={true} onToggleShare={vi.fn()} />
      </div>,
    )
    await user.click(screen.getByLabelText('Share'))
    expect(screen.getByTestId('share-popover')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryByTestId('share-popover')).not.toBeInTheDocument()
  })
})
