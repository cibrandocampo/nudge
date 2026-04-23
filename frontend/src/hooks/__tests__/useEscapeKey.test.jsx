import { renderWithProviders } from '../../test/helpers'
import { useEscapeKey } from '../useEscapeKey'

function Probe({ onEscape, enabled }) {
  useEscapeKey(onEscape, enabled)
  return <div data-testid="probe" />
}

function fireKey(key) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key }))
}

describe('useEscapeKey', () => {
  it('calls the callback on Escape keydown', () => {
    const spy = vi.fn()
    renderWithProviders(<Probe onEscape={spy} enabled={true} />)
    fireKey('Escape')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('ignores keys other than Escape', () => {
    const spy = vi.fn()
    renderWithProviders(<Probe onEscape={spy} enabled={true} />)
    fireKey('Enter')
    fireKey('a')
    expect(spy).not.toHaveBeenCalled()
  })

  it('removes the listener on unmount', () => {
    const spy = vi.fn()
    const { unmount } = renderWithProviders(<Probe onEscape={spy} enabled={true} />)
    unmount()
    fireKey('Escape')
    expect(spy).not.toHaveBeenCalled()
  })

  it('does not attach when enabled is false', () => {
    const spy = vi.fn()
    renderWithProviders(<Probe onEscape={spy} enabled={false} />)
    fireKey('Escape')
    expect(spy).not.toHaveBeenCalled()
  })
})
