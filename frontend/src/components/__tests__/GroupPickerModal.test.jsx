import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import GroupPickerModal from '../GroupPickerModal'

const groups = [
  { id: 1, name: 'Fridge' },
  { id: 2, name: 'Pantry' },
]

describe('GroupPickerModal', () => {
  const defaultProps = {
    groups,
    currentGroupId: null,
    onSelect: vi.fn(),
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all groups plus no-group option', () => {
    renderWithProviders(<GroupPickerModal {...defaultProps} />)
    expect(screen.getByText('Fridge')).toBeInTheDocument()
    expect(screen.getByText('Pantry')).toBeInTheDocument()
  })

  it('marks no-group as selected when currentGroupId is null', () => {
    renderWithProviders(<GroupPickerModal {...defaultProps} currentGroupId={null} />)
    const items = screen.getAllByRole('radio')
    expect(items[0]).toHaveAttribute('aria-checked', 'true')
    expect(items[1]).toHaveAttribute('aria-checked', 'false')
  })

  it('marks correct group as selected', () => {
    renderWithProviders(<GroupPickerModal {...defaultProps} currentGroupId={1} />)
    const items = screen.getAllByRole('radio')
    expect(items[0]).toHaveAttribute('aria-checked', 'false')
    expect(items[1]).toHaveAttribute('aria-checked', 'true')
  })

  it('calls onSelect with null when no-group item clicked', async () => {
    const onSelect = vi.fn()
    const { user } = renderWithProviders(<GroupPickerModal {...defaultProps} onSelect={onSelect} />)
    await user.click(screen.getAllByRole('radio')[0])
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('calls onSelect with group id when group item clicked', async () => {
    const onSelect = vi.fn()
    const { user } = renderWithProviders(<GroupPickerModal {...defaultProps} onSelect={onSelect} />)
    await user.click(screen.getByText('Fridge'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('calls onSelect on Enter key for no-group item', () => {
    const onSelect = vi.fn()
    renderWithProviders(<GroupPickerModal {...defaultProps} onSelect={onSelect} />)
    fireEvent.keyDown(screen.getAllByRole('radio')[0], { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('calls onSelect on Enter key for group item', () => {
    const onSelect = vi.fn()
    renderWithProviders(<GroupPickerModal {...defaultProps} onSelect={onSelect} />)
    fireEvent.keyDown(screen.getByText('Fridge').closest('[role="radio"]'), { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('calls onClose when cancel button clicked', async () => {
    const onClose = vi.fn()
    const { user } = renderWithProviders(<GroupPickerModal {...defaultProps} onClose={onClose} />)
    await user.click(screen.getByRole('button'))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when overlay clicked', () => {
    const onClose = vi.fn()
    renderWithProviders(<GroupPickerModal {...defaultProps} onClose={onClose} />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn()
    renderWithProviders(<GroupPickerModal {...defaultProps} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onSelect on non-Enter key', () => {
    const onSelect = vi.fn()
    renderWithProviders(<GroupPickerModal {...defaultProps} onSelect={onSelect} />)
    fireEvent.keyDown(screen.getAllByRole('radio')[0], { key: 'Space' })
    expect(onSelect).not.toHaveBeenCalled()
  })
})
