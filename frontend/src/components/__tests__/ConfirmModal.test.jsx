import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import ConfirmModal from '../ConfirmModal'

describe('ConfirmModal', () => {
  const props = {
    message: 'Are you sure?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders message text', () => {
    renderWithProviders(<ConfirmModal {...props} />)
    expect(screen.getByText('Are you sure?')).toBeInTheDocument()
  })

  it('calls onCancel when Cancel button clicked', async () => {
    const { user } = renderWithProviders(<ConfirmModal {...props} />)
    await user.click(screen.getByText('Cancel'))
    expect(props.onCancel).toHaveBeenCalled()
  })

  it('calls onConfirm when Confirm button clicked', async () => {
    const { user } = renderWithProviders(<ConfirmModal {...props} />)
    await user.click(screen.getByText('Confirm'))
    expect(props.onConfirm).toHaveBeenCalled()
  })

  it('calls onCancel when overlay is clicked', () => {
    renderWithProviders(<ConfirmModal {...props} />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(props.onCancel).toHaveBeenCalled()
  })

  it('calls onCancel on Escape key', () => {
    renderWithProviders(<ConfirmModal {...props} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.onCancel).toHaveBeenCalled()
  })

  it('renders custom confirmLabel', () => {
    renderWithProviders(<ConfirmModal {...props} confirmLabel="Delete" />)
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })
})
