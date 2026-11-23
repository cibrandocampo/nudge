import { useState } from 'react'
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

  it('applies both framed and md size classes when variant="framed" and size="md"', () => {
    renderWithProviders(
      <ModalFrame onClose={vi.fn()} variant="framed" size="md">
        <p>body</p>
      </ModalFrame>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toMatch(/modalBoxFramed/)
    expect(dialog.className).toMatch(/modalBoxMd/)
  })

  it('applies both framed and lg size classes when variant="framed" and size="lg"', () => {
    renderWithProviders(
      <ModalFrame onClose={vi.fn()} variant="framed" size="lg">
        <p>body</p>
      </ModalFrame>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toMatch(/modalBoxFramed/)
    expect(dialog.className).toMatch(/modalBoxLg/)
  })

  it('uses the closeAriaLabel override when there is no title', () => {
    renderWithProviders(
      <ModalFrame onClose={vi.fn()} closeAriaLabel="Dismiss settings">
        <p>body</p>
      </ModalFrame>,
    )
    expect(screen.getByRole('dialog', { name: 'Dismiss settings' })).toBeInTheDocument()
  })

  describe('close button', () => {
    it('shows a named close button that closes the modal', async () => {
      const onClose = vi.fn()
      const { user } = renderWithProviders(<ModalFrame onClose={onClose} title="Share" />)

      await user.click(screen.getByRole('button', { name: 'Close' }))

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('hides it with showClose={false}', () => {
      renderWithProviders(<ModalFrame onClose={vi.fn()} showClose={false} />)
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    })

    it('names the dialog after its title', () => {
      renderWithProviders(<ModalFrame onClose={vi.fn()} title="Share" />)
      expect(screen.getByRole('dialog', { name: 'Share' })).toBeInTheDocument()
    })

    it('names the dialog after a heading drawn by its children', () => {
      renderWithProviders(
        <ModalFrame onClose={vi.fn()} variant="framed" labelledBy="own-title">
          <h2 id="own-title">Conflict</h2>
        </ModalFrame>,
      )
      expect(screen.getByRole('dialog', { name: 'Conflict' })).toBeInTheDocument()
    })

    it('renders the subtitle under the title', () => {
      renderWithProviders(<ModalFrame onClose={vi.fn()} title="Share" subtitle="Pick a contact" />)
      expect(screen.getByText('Pick a contact')).toBeInTheDocument()
    })
  })

  describe('focus', () => {
    function Page({ removeTrigger = false }) {
      const [open, setOpen] = useState(false)
      const [triggerGone, setTriggerGone] = useState(false)
      const close = () => {
        setOpen(false)
        if (removeTrigger) setTriggerGone(true)
      }
      return (
        <>
          <h1>Page title</h1>
          {!triggerGone && <button onClick={() => setOpen(true)}>open</button>}
          {open && (
            <ModalFrame onClose={close} title="Dialog">
              <button>first action</button>
              <button>last action</button>
            </ModalFrame>
          )}
        </>
      )
    }

    it('moves focus into the dialog on open', async () => {
      const { user } = renderWithProviders(<Page />)
      await user.click(screen.getByRole('button', { name: 'open' }))
      expect(screen.getByRole('dialog')).toHaveFocus()
    })

    it('keeps the focus on a child that asked for it', () => {
      renderWithProviders(
        <ModalFrame onClose={vi.fn()}>
          <input aria-label="field" autoFocus />
        </ModalFrame>,
      )
      expect(screen.getByLabelText('field')).toHaveFocus()
    })

    it('wraps Tab from the last control to the first', async () => {
      const { user } = renderWithProviders(<Page />)
      await user.click(screen.getByRole('button', { name: 'open' }))
      screen.getByRole('button', { name: 'last action' }).focus()

      await user.tab()

      expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    })

    it('wraps Shift+Tab from the dialog to the last control', async () => {
      const { user } = renderWithProviders(<Page />)
      await user.click(screen.getByRole('button', { name: 'open' }))

      await user.tab({ shift: true })

      expect(screen.getByRole('button', { name: 'last action' })).toHaveFocus()
    })

    it('keeps Tab inside a dialog with nothing to focus', () => {
      renderWithProviders(<ModalFrame onClose={vi.fn()} showClose={false} />)
      const dialog = screen.getByRole('dialog')

      const notPrevented = fireEvent.keyDown(dialog, { key: 'Tab' })

      expect(notPrevented).toBe(false)
      expect(dialog).toHaveFocus()
    })

    it('returns focus to the trigger on close', async () => {
      const { user } = renderWithProviders(<Page />)
      await user.click(screen.getByRole('button', { name: 'open' }))

      await user.keyboard('{Escape}')

      expect(screen.getByRole('button', { name: 'open' })).toHaveFocus()
    })

    it('falls back to the page heading when the trigger is gone', async () => {
      const { user } = renderWithProviders(<Page removeTrigger />)
      await user.click(screen.getByRole('button', { name: 'open' }))

      await user.keyboard('{Escape}')

      expect(screen.getByRole('heading', { name: 'Page title' })).toHaveFocus()
    })
  })

  describe('typed content', () => {
    const scrim = () => screen.getByRole('dialog').parentElement

    it('does not close on a scrim tap while dirty', () => {
      const onClose = vi.fn()
      renderWithProviders(<ModalFrame onClose={onClose} dirty />)
      fireEvent.click(scrim())
      expect(onClose).not.toHaveBeenCalled()
    })

    it('still closes with the close button while dirty', async () => {
      const onClose = vi.fn()
      const { user } = renderWithProviders(<ModalFrame onClose={onClose} dirty />)
      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('still closes with Escape while dirty', () => {
      const onClose = vi.fn()
      renderWithProviders(<ModalFrame onClose={onClose} dirty />)
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('does not close when a drag starts in the box and ends on the scrim', () => {
      const onClose = vi.fn()
      renderWithProviders(<ModalFrame onClose={onClose} />)

      fireEvent.pointerDown(screen.getByRole('dialog'))
      fireEvent.click(scrim())

      expect(onClose).not.toHaveBeenCalled()
    })

    it('closes on the next real scrim tap after such a drag', () => {
      const onClose = vi.fn()
      renderWithProviders(<ModalFrame onClose={onClose} />)
      fireEvent.pointerDown(screen.getByRole('dialog'))
      fireEvent.click(scrim())

      fireEvent.pointerDown(scrim())
      fireEvent.click(scrim())

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
