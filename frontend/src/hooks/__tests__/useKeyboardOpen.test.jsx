import { act, renderHook } from '@testing-library/react'
import { useKeyboardOpen } from '../useKeyboardOpen'

let viewport
let input

function setViewport(values) {
  act(() => {
    Object.assign(viewport, values)
    viewport.dispatchEvent(new Event('resize'))
  })
}

const focus = (element) => act(() => element.focus())

beforeEach(() => {
  viewport = Object.assign(new EventTarget(), { width: 412, height: 900, scale: 1 })
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  input = document.createElement('input')
  document.body.appendChild(input)
})

afterEach(() => {
  input.remove()
  delete window.visualViewport
})

describe('useKeyboardOpen', () => {
  it('is open with a field focused and the visible height down', () => {
    const { result } = renderHook(() => useKeyboardOpen())
    focus(input)

    setViewport({ height: 500 })

    expect(result.current).toBe(true)
  })

  it('closes when the visible height comes back', () => {
    const { result } = renderHook(() => useKeyboardOpen())
    focus(input)
    setViewport({ height: 500 })

    setViewport({ height: 900 })

    expect(result.current).toBe(false)
  })

  it('closes when the field loses focus', () => {
    const { result } = renderHook(() => useKeyboardOpen())
    focus(input)
    setViewport({ height: 500 })

    act(() => input.blur())

    expect(result.current).toBe(false)
  })

  it('stays closed when the height drops with no field focused', () => {
    const { result } = renderHook(() => useKeyboardOpen())

    setViewport({ height: 500 })

    expect(result.current).toBe(false)
  })

  it('ignores a browser toolbar collapsing', () => {
    const { result } = renderHook(() => useKeyboardOpen())
    focus(input)

    setViewport({ height: 844 })

    expect(result.current).toBe(false)
  })

  it('does not take a rotation for a keyboard', () => {
    const { result } = renderHook(() => useKeyboardOpen())
    focus(input)

    setViewport({ width: 900, height: 412 })

    expect(result.current).toBe(false)
  })

  it('does not take a pinch zoom for a keyboard', () => {
    const { result } = renderHook(() => useKeyboardOpen())
    focus(input)

    setViewport({ height: 450, scale: 2 })

    expect(result.current).toBe(false)
  })

  it.each(['checkbox', 'date', 'button'])('does not count a %s input', (type) => {
    input.type = type
    const { result } = renderHook(() => useKeyboardOpen())
    focus(input)

    setViewport({ height: 500 })

    expect(result.current).toBe(false)
  })

  it('counts a textarea', () => {
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    const { result } = renderHook(() => useKeyboardOpen())
    focus(textarea)

    setViewport({ height: 500 })

    expect(result.current).toBe(true)
    textarea.remove()
  })

  it('is false in a browser without visualViewport', () => {
    delete window.visualViewport
    const { result } = renderHook(() => useKeyboardOpen())
    focus(input)

    expect(result.current).toBe(false)
  })
})
