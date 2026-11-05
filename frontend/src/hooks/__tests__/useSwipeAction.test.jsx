import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LEFT_MAX_PX, useSwipeAction } from '../useSwipeAction'

// The element is 300px wide: the threshold sits at 114px (0.38) and a blocked
// element caps at 120px (0.4), reached with a 240px drag (0.5 resistance).
const WIDTH = 300
const T0 = new Date('2026-11-04T10:00:00.000Z')

// Latest value returned by the hook, published after every render.
let swipe

function Harness({ onChildClick, ...options }) {
  const result = useSwipeAction(options)
  useEffect(() => {
    swipe = result
  })
  return (
    <div data-testid="target" {...result.handlers}>
      <button onClick={onChildClick}>child</button>
    </div>
  )
}

function renderHarness(options = {}) {
  const props = { enabled: true, blocked: false, onCommit: vi.fn(), onChildClick: vi.fn(), ...options }
  const view = render(<Harness {...props} />)
  return { ...view, props, target: screen.getByTestId('target') }
}

// Pointer helpers. `advance` moves the fake clock before the event so the
// velocity window sees real elapsed time.
function down(target, x = 0, y = 0) {
  fireEvent.pointerDown(target, { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y })
}
function move(target, x, y = 0, advance = 0) {
  act(() => vi.advanceTimersByTime(advance))
  fireEvent.pointerMove(target, { pointerId: 1, clientX: x, clientY: y })
}
function up(target, x, advance = 0) {
  act(() => vi.advanceTimersByTime(advance))
  fireEvent.pointerUp(target, { pointerId: 1, clientX: x, clientY: 0 })
}
// A slow drag: 20px every 50ms, far below the flick velocity.
function slowDragTo(target, x) {
  for (let pos = 20; pos <= x; pos += 20) move(target, pos, 0, 50)
}

let mediaListeners
let mediaMatches

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: WIDTH })
  Element.prototype.setPointerCapture = vi.fn()
  mediaListeners = []
  mediaMatches = false
  window.matchMedia = vi.fn((query) => ({
    matches: mediaMatches,
    media: query,
    addEventListener: (_type, fn) => mediaListeners.push(fn),
    removeEventListener: (_type, fn) => {
      mediaListeners = mediaListeners.filter((l) => l !== fn)
    },
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete Element.prototype.setPointerCapture
})

describe('useSwipeAction', () => {
  it('does not move before the axis lock distance', () => {
    const { target } = renderHarness()
    down(target)
    move(target, 9)
    expect(swipe.offset).toBe(0)
    expect(swipe.dragging).toBe(false)
  })

  it('ignores a vertical gesture until the pointer lifts, even if it then goes sideways', () => {
    const { target, props } = renderHarness()
    down(target)
    move(target, 2, 30)
    move(target, 200, 30)
    expect(swipe.offset).toBe(0)
    expect(swipe.dragging).toBe(false)
    up(target, 200)
    expect(props.onCommit).not.toHaveBeenCalled()
  })

  it('captures the pointer once the drag is horizontal, never for a scroll', () => {
    // Without the capture the card stops following as soon as the finger
    // leaves it, which on a phone is most drags.
    const { target } = renderHarness()
    down(target)
    move(target, 2, 30)
    expect(Element.prototype.setPointerCapture).not.toHaveBeenCalled()
    up(target, 2)

    down(target)
    move(target, 5)
    expect(Element.prototype.setPointerCapture).not.toHaveBeenCalled()
    move(target, 20)
    expect(Element.prototype.setPointerCapture).toHaveBeenCalledTimes(1)
    expect(Element.prototype.setPointerCapture).toHaveBeenCalledWith(1)
  })

  it('tracks a drag below the threshold proportionally and springs back on release', () => {
    const { target, props } = renderHarness()
    down(target)
    slowDragTo(target, 60)
    expect(swipe.offset).toBe(60)
    expect(swipe.progress).toBeCloseTo(60 / 114)
    expect(swipe.armed).toBe(false)
    expect(swipe.dragging).toBe(true)
    up(target, 60, 50)
    expect(swipe.offset).toBe(0)
    expect(swipe.dragging).toBe(false)
    expect(props.onCommit).not.toHaveBeenCalled()
  })

  it('arms when crossing the threshold and disarms when going back below it', () => {
    const { target } = renderHarness()
    down(target)
    slowDragTo(target, 120)
    expect(swipe.armed).toBe(true)
    expect(swipe.progress).toBe(1)
    move(target, 100, 0, 50)
    expect(swipe.armed).toBe(false)
  })

  it('commits once when released armed and keeps the offset for the exit', () => {
    const { target, props } = renderHarness()
    down(target)
    slowDragTo(target, 160)
    up(target, 160, 50)
    expect(props.onCommit).toHaveBeenCalledTimes(1)
    expect(swipe.offset).toBe(160)
    expect(swipe.dragging).toBe(false)
  })

  it('commits a fast flick that stays below the threshold', () => {
    const { target, props } = renderHarness()
    down(target)
    move(target, 40, 0, 20)
    move(target, 80, 0, 20)
    up(target, 80, 10)
    expect(props.onCommit).toHaveBeenCalledTimes(1)
  })

  it('commits a slow drag that ends in a quick flick', () => {
    const { target, props } = renderHarness()
    down(target)
    // 400ms of slow movement then a tirón: averaged from pointerdown it would
    // be ~0.2 px/ms, under the flick velocity.
    slowDragTo(target, 40)
    move(target, 40, 0, 300)
    move(target, 100, 0, 50)
    up(target, 100, 10)
    expect(props.onCommit).toHaveBeenCalledTimes(1)
  })

  it('damps and caps a leftward drag and never commits it, not even flicked back right', () => {
    const { target, props } = renderHarness()
    down(target)
    move(target, -40, 0, 20)
    expect(swipe.offset).toBe(-6)
    move(target, -200, 0, 20)
    expect(swipe.offset).toBe(-LEFT_MAX_PX)
    expect(swipe.armed).toBe(false)
    // A pause, then a quick move back to the right that still ends left of
    // the origin: fast enough for a flick, but a flick needs a positive offset.
    move(target, -190, 0, 200)
    move(target, -20, 0, 10)
    up(target, -20, 5)
    expect(props.onCommit).not.toHaveBeenCalled()
    expect(swipe.offset).toBe(0)
  })

  it('resists a blocked element, never arms it and reports an attempt at the cap', () => {
    const onBlockedAttempt = vi.fn()
    const { target, props } = renderHarness({ blocked: true, onBlockedAttempt })
    down(target)
    move(target, 100, 0, 5)
    expect(swipe.offset).toBe(50)
    move(target, 280, 0, 5)
    expect(swipe.offset).toBe(120)
    expect(swipe.armed).toBe(false)
    up(target, 280, 5)
    expect(props.onCommit).not.toHaveBeenCalled()
    expect(onBlockedAttempt).toHaveBeenCalledTimes(1)
    expect(swipe.offset).toBe(0)
  })

  it('does not report a blocked attempt released short of the cap', () => {
    const onBlockedAttempt = vi.fn()
    const { target } = renderHarness({ blocked: true, onBlockedAttempt })
    down(target)
    move(target, 100, 0, 5)
    up(target, 100, 5)
    expect(onBlockedAttempt).not.toHaveBeenCalled()
    expect(swipe.offset).toBe(0)
  })

  it('springs back without committing on pointercancel, even when armed', () => {
    const { target, props } = renderHarness()
    down(target)
    slowDragTo(target, 160)
    expect(swipe.armed).toBe(true)
    fireEvent.pointerCancel(target, { pointerId: 1 })
    expect(swipe.offset).toBe(0)
    expect(swipe.dragging).toBe(false)
    up(target, 160)
    expect(props.onCommit).not.toHaveBeenCalled()
  })

  it('swallows the click after a drag but lets a tap through', () => {
    const { target, props } = renderHarness()
    const child = screen.getByRole('button', { name: 'child' })

    down(target)
    slowDragTo(target, 60)
    up(target, 60, 50)
    fireEvent.click(child)
    expect(props.onChildClick).not.toHaveBeenCalled()

    down(target, 5, 5)
    move(target, 8, 6)
    up(target, 8)
    fireEvent.click(child)
    expect(props.onChildClick).toHaveBeenCalledTimes(1)
  })

  it('ignores a second finger that touches down while the first one drags', () => {
    const { target, props } = renderHarness()
    down(target)
    slowDragTo(target, 60)
    // A second touch is never the primary pointer: it lands, moves past the
    // threshold and lifts without taking the gesture over.
    fireEvent.pointerDown(target, { pointerId: 2, isPrimary: false, button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(target, { pointerId: 2, clientX: 250, clientY: 0 })
    fireEvent.pointerUp(target, { pointerId: 2, clientX: 250, clientY: 0 })
    fireEvent.pointerCancel(target, { pointerId: 2 })
    expect(swipe.offset).toBe(60)
    expect(swipe.dragging).toBe(true)
    expect(props.onCommit).not.toHaveBeenCalled()
    // The first finger still owns the drag.
    move(target, 160, 0, 50)
    up(target, 160, 50)
    expect(props.onCommit).toHaveBeenCalledTimes(1)
  })

  it('ignores a pointercancel that arrives with no gesture in progress', () => {
    // The browser can cancel a pointer the hook never tracked (a disabled
    // card, a scroll that started elsewhere); the next swipe must still work.
    const { target, props } = renderHarness()
    fireEvent.pointerCancel(target, { pointerId: 1 })
    expect(swipe.offset).toBe(0)
    down(target)
    slowDragTo(target, 160)
    up(target, 160, 50)
    expect(props.onCommit).toHaveBeenCalledTimes(1)
  })

  it('ignores a drag started with a non-primary mouse button', () => {
    const { target, props } = renderHarness()
    fireEvent.pointerDown(target, { pointerId: 1, isPrimary: true, button: 2, clientX: 0, clientY: 0 })
    slowDragTo(target, 160)
    up(target, 160, 50)
    expect(swipe.offset).toBe(0)
    expect(swipe.dragging).toBe(false)
    expect(props.onCommit).not.toHaveBeenCalled()
  })

  it('does not treat a release with no elapsed time as a flick', () => {
    const { target, props } = renderHarness()
    down(target)
    move(target, 60)
    up(target, 60)
    expect(props.onCommit).not.toHaveBeenCalled()
    expect(swipe.offset).toBe(0)
  })

  it('ignores every pointer event when disabled', () => {
    const { target, props } = renderHarness({ enabled: false })
    down(target)
    slowDragTo(target, 160)
    up(target, 160, 50)
    expect(swipe.offset).toBe(0)
    expect(swipe.dragging).toBe(false)
    expect(props.onCommit).not.toHaveBeenCalled()
  })

  it('reset() brings a committed element back to rest', () => {
    const { target } = renderHarness()
    down(target)
    slowDragTo(target, 160)
    up(target, 160, 50)
    expect(swipe.offset).toBe(160)
    act(() => swipe.reset())
    expect(swipe.offset).toBe(0)
    expect(swipe.progress).toBe(0)
  })

  it('reflects prefers-reduced-motion and follows its changes', () => {
    mediaMatches = true
    const { unmount } = renderHarness()
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
    expect(swipe.reducedMotion).toBe(true)
    act(() => mediaListeners.forEach((fn) => fn({ matches: false })))
    expect(swipe.reducedMotion).toBe(false)
    unmount()
    expect(mediaListeners).toHaveLength(0)
  })
})
