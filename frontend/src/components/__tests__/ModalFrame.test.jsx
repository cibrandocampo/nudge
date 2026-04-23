import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import ModalFrame from '../ModalFrame'

describe('ModalFrame', () => {
  it('renders children inside a role=dialog with aria-modal', () => {
    renderWithProviders(
      <ModalFrame onClose={vi.fn()}>
        <p>body</p>
      </ModalFrame>,
    )
    expect(screen.getByText('body')).toBeInTheDocument()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    renderWithProviders(
      <ModalFrame onClose={onClose}>
        <p>body</p>
      </ModalFrame>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the overlay is clicked', () => {
    const onClose = vi.fn()
    const { container } = renderWithProviders(
      <ModalFrame onClose={onClose}>
        <p>body</p>
      </ModalFrame>,
    )
    fireEvent.click(container.firstChild)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose when the box is clicked', () => {
    const onClose = vi.fn()
    renderWithProviders(
      <ModalFrame onClose={onClose}>
        <p>body</p>
      </ModalFrame>,
    )
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders a title when provided', () => {
    renderWithProviders(
      <ModalFrame onClose={vi.fn()} title="Confirm">
        <p>body</p>
      </ModalFrame>,
    )
    expect(screen.getByRole('heading', { name: 'Confirm' })).toBeInTheDocument()
  })

  it('applies the md size class when size="md"', () => {
    renderWithProviders(
      <ModalFrame onClose={vi.fn()} size="md">
        <p>body</p>
      </ModalFrame>,
    )
    expect(screen.getByRole('dialog').className).toMatch(/modalBoxMd/)
  })

  it('applies the lg size class when size="lg"', () => {
    renderWithProviders(
      <ModalFrame onClose={vi.fn()} size="lg">
        <p>body</p>
      </ModalFrame>,
    )
    expect(screen.getByRole('dialog').className).toMatch(/modalBoxLg/)
  })

  it('uses modalBoxFramed when variant="framed"', () => {
    renderWithProviders(
      <ModalFrame onClose={vi.fn()} variant="framed">
        <p>body</p>
      </ModalFrame>,
    )
    expect(screen.getByRole('dialog').className).toMatch(/modalBoxFramed/)
  })
})
