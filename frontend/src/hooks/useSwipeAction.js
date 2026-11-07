import { useEffect, useRef, useState } from 'react'

// Movement (px) before deciding whether the gesture is a horizontal swipe or a
// vertical scroll. Below it nothing moves, so a tap stays a tap.
export const AXIS_LOCK_PX = 10
// Fraction of the element's width a right swipe must cover to arm the commit.
export const THRESHOLD_RATIO = 0.38
// Rightward speed (px/ms) that commits on release even below the threshold.
export const FLICK_VELOCITY = 0.6
// Leftward drags have no action: damped by this factor and capped, so the card
// only gives a little to show it is alive.
export const LEFT_RESISTANCE = 0.15
export const LEFT_MAX_PX = 16
// A blocked element (no stock) follows the finger damped and capped at this
// fraction of its width, then springs back. It never arms. The cap leaves room
// for the "No stock available" label behind the card.
export const BLOCKED_RESISTANCE = 0.5
export const BLOCKED_MAX_RATIO = 0.4
// Only the last stretch of movement counts towards the release velocity, so a
// slow drag that ends in a quick flick still commits.
const VELOCITY_WINDOW_MS = 100

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function dampLeft(dx) {
  return Math.max(dx * LEFT_RESISTANCE, -LEFT_MAX_PX)
}

/**
 * Turns a horizontal drag into a swipe-to-act gesture (T100), Gmail style:
 * the element follows the finger to the right, arms past a threshold and
 * commits on release — or springs back.
 *
 * Built on Pointer Events so touch, pen and mouse share one path. The element
 * receiving `handlers` should set `touch-action: pan-y`, so the browser keeps
 * vertical scrolling and hands horizontal movement to us; if the browser takes
 * over anyway it fires `pointercancel`, which never commits.
 *
 * The hook only reports state and calls `onCommit`: exit animations, the
 * mutation and any follow-up UI belong to the caller. After a commit `offset`
 * stays where the finger left it so the caller can animate from there; call
 * `reset()` to bring the element back to rest.
 *
 * @param {object} options
 * @param {boolean} options.enabled - false ignores every pointer event.
 * @param {boolean} options.blocked - the action is unavailable: resist, never arm.
 * @param {Function} options.onCommit - released armed, or flicked right.
 * @param {Function} [options.onBlockedAttempt] - a blocked element was
 *   released at its cap, i.e. the user really tried.
 */
export function useSwipeAction({ enabled, blocked, onCommit, onBlockedAttempt }) {
  const [offset, setOffsetState] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [width, setWidth] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia(REDUCED_MOTION_QUERY).matches)
  // Per-gesture bookkeeping that must not trigger renders.
  const gestureRef = useRef(null)
  // Mirrors `offset` so pointerup reads the value the last move produced, not
  // the one captured by this render's closure.
  const offsetRef = useRef(0)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY)
    const onChange = (event) => setReducedMotion(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  function setOffset(value) {
    offsetRef.current = value
    setOffsetState(value)
  }

  function reset() {
    gestureRef.current = null
    setDragging(false)
    setOffset(0)
  }

  const threshold = width * THRESHOLD_RATIO
  const blockedCap = width * BLOCKED_MAX_RATIO

  function onPointerDown(event) {
    // Only the first finger, or a mouse's main button, starts a gesture: a
    // second touch must not take over the drag in progress, and a right-
    // or middle-button drag is not a swipe.
    if (!enabled || !event.isPrimary || event.button !== 0) return
    const now = Date.now()
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      axis: null,
      samples: [{ t: now, x: event.clientX }],
    }
    suppressClickRef.current = false
    setWidth(event.currentTarget.getBoundingClientRect().width)
  }

  function onPointerMove(event) {
    const gesture = gestureRef.current
    if (!enabled || !gesture || event.pointerId !== gesture.pointerId) return
    const dx = event.clientX - gesture.startX
    const dy = event.clientY - gesture.startY

    if (gesture.axis === null) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK_PX) return
      gesture.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (gesture.axis === 'x') {
        // Keep receiving moves even if the finger leaves the element, and
        // swallow the click the browser fires after the drag.
        event.currentTarget.setPointerCapture(event.pointerId)
        suppressClickRef.current = true
        setDragging(true)
      }
    }
    // A vertical gesture is a scroll: ignored until the pointer lifts.
    if (gesture.axis === 'y') return

    const now = Date.now()
    gesture.samples = gesture.samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS)
    gesture.samples.push({ t: now, x: event.clientX })

    if (dx < 0) setOffset(dampLeft(dx))
    else if (blocked) setOffset(Math.min(dx * BLOCKED_RESISTANCE, blockedCap))
    else setOffset(dx)
  }

  function onPointerUp(event) {
    const gesture = gestureRef.current
    if (!enabled || !gesture || event.pointerId !== gesture.pointerId) return
    gestureRef.current = null
    if (gesture.axis !== 'x') return

    const released = offsetRef.current
    const first = gesture.samples[0]
    const elapsed = Date.now() - first.t
    const velocity = elapsed > 0 ? (event.clientX - first.x) / elapsed : 0

    if (blocked) {
      if (released >= blockedCap) onBlockedAttempt?.()
      reset()
      return
    }
    if (released >= threshold || (released > 0 && velocity >= FLICK_VELOCITY)) {
      setDragging(false)
      onCommit()
      return
    }
    reset()
  }

  function onPointerCancel(event) {
    const gesture = gestureRef.current
    if (!gesture || event.pointerId !== gesture.pointerId) return
    suppressClickRef.current = false
    reset()
  }

  function onClickCapture(event) {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture },
    offset,
    progress: threshold > 0 ? Math.min(Math.max(offset, 0) / threshold, 1) : 0,
    armed: !blocked && threshold > 0 && offset >= threshold,
    dragging,
    reset,
    reducedMotion,
  }
}
