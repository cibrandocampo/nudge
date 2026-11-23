import { useRef, useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { focusFirstInvalid, shouldAutoFocus, showInvalid } from '../forms'

const originalMatchMedia = window.matchMedia
const mockMedia = (matching) => {
  window.matchMedia = (query) => ({ matches: query === matching })
}

afterEach(() => {
  window.matchMedia = originalMatchMedia
  delete Element.prototype.scrollIntoView
})

describe('shouldAutoFocus', () => {
  it('is true with a fine pointer', () => {
    mockMedia('(pointer: fine)')
    expect(shouldAutoFocus()).toBe(true)
  })

  it('is false on a touch screen', () => {
    mockMedia('(pointer: coarse)')
    expect(shouldAutoFocus()).toBe(false)
  })

  it('is false in a browser without matchMedia', () => {
    const original = window.matchMedia
    window.matchMedia = undefined
    expect(shouldAutoFocus()).toBe(false)
    window.matchMedia = original
  })
})

describe('focusFirstInvalid', () => {
  it('focuses the first marked control in document order', () => {
    const { container } = render(
      <form>
        <input aria-label="valid" />
        <input aria-label="first" data-invalid="true" />
        <input aria-label="second" data-invalid="true" />
      </form>,
    )
    focusFirstInvalid(container)
    expect(screen.getByLabelText('first')).toHaveFocus()
  })

  it('focuses the control inside a marked wrapper', () => {
    const { container } = render(
      <div data-invalid="true">
        <input aria-label="inner" />
      </div>,
    )
    focusFirstInvalid(container)
    expect(screen.getByLabelText('inner')).toHaveFocus()
  })

  it('focuses the message when the error has no single field', () => {
    const { container } = render(
      <p data-invalid="true" tabIndex={-1}>
        Fix the batches
      </p>,
    )
    focusFirstInvalid(container)
    expect(screen.getByText('Fix the batches')).toHaveFocus()
  })

  it('does nothing when nothing is marked', () => {
    const { container } = render(<input aria-label="field" />)
    focusFirstInvalid(container)
    expect(screen.getByLabelText('field')).not.toHaveFocus()
  })

  it('scrolls without animation under reduced motion', () => {
    mockMedia('(prefers-reduced-motion: reduce)')
    Element.prototype.scrollIntoView = vi.fn()
    const { container } = render(<input aria-label="field" data-invalid="true" />)
    focusFirstInvalid(container)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
  })

  it('scrolls smoothly otherwise', () => {
    Element.prototype.scrollIntoView = vi.fn()
    const { container } = render(<input aria-label="field" data-invalid="true" />)
    focusFirstInvalid(container)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
  })
})

describe('showInvalid', () => {
  function Form() {
    const ref = useRef(null)
    const [error, setError] = useState(false)
    return (
      <form
        ref={ref}
        onSubmit={(e) => {
          e.preventDefault()
          showInvalid(ref.current, () => setError(true))
        }}
      >
        <input aria-label="field" data-invalid={error ? 'true' : undefined} />
        <button>Send</button>
      </form>
    )
  }

  it('focuses a field the error has only just marked', async () => {
    const user = userEvent.setup()
    render(<Form />)
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByLabelText('field')).toHaveFocus()
  })

  it('focuses it again when the same error repeats', async () => {
    const user = userEvent.setup()
    render(<Form />)
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByLabelText('field')).toHaveFocus()
  })
})
