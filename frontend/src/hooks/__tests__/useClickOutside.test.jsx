import { useRef } from 'react'
import { renderWithProviders } from '../../test/helpers'
import { useClickOutside } from '../useClickOutside'

function Probe({ onOutside, enabled = true }) {
  const ref = useRef(null)
  useClickOutside(ref, onOutside, enabled)
  return (
    <div>
      <div ref={ref} data-testid="inside">
        inside
      </div>
      <div data-testid="outside">outside</div>
    </div>
  )
}

function mouseDownOn(node) {
  node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
}

describe('useClickOutside', () => {
  it('calls the callback on mousedown outside the ref', () => {
    const spy = vi.fn()
    const { getByTestId } = renderWithProviders(<Probe onOutside={spy} />)
    mouseDownOn(getByTestId('outside'))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('does not call the callback on mousedown inside the ref', () => {
    const spy = vi.fn()
    const { getByTestId } = renderWithProviders(<Probe onOutside={spy} />)
    mouseDownOn(getByTestId('inside'))
    expect(spy).not.toHaveBeenCalled()
  })

  it('removes the listener on unmount', () => {
    const spy = vi.fn()
    const { getByTestId, unmount } = renderWithProviders(<Probe onOutside={spy} />)
    const outside = getByTestId('outside')
    unmount()
    mouseDownOn(outside)
    expect(spy).not.toHaveBeenCalled()
  })

  it('does not attach when enabled is false', () => {
    const spy = vi.fn()
    const { getByTestId } = renderWithProviders(<Probe onOutside={spy} enabled={false} />)
    mouseDownOn(getByTestId('outside'))
    expect(spy).not.toHaveBeenCalled()
  })
})
