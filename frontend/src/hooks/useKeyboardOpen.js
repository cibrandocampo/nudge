import { useEffect, useState } from 'react'

// More than a browser toolbar collapsing (about 56 px), less than any keyboard.
const KEYBOARD_MIN_PX = 120
const NO_KEYBOARD_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'date',
  'datetime-local',
  'file',
  'month',
  'radio',
  'range',
  'reset',
  'submit',
  'time',
  'week',
])

function opensKeyboard(element) {
  if (!element) return false
  if (element.tagName === 'TEXTAREA' || element.isContentEditable) return true
  return element.tagName === 'INPUT' && !NO_KEYBOARD_INPUTS.has(element.type)
}

/**
 * Whether the on-screen keyboard is up. There is no direct signal, so it reads
 * two: a field that types is focused, and the visible height has dropped well
 * below the tallest seen at this width. A rotation changes the width and starts
 * over; a pinch zoom shrinks the visible height too, so it never counts.
 */
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return undefined

    let width = viewport.width
    let tallest = viewport.height

    const update = (focused) => {
      if (viewport.width !== width) {
        width = viewport.width
        tallest = viewport.height
      }
      tallest = Math.max(tallest, viewport.height)
      const zoomed = viewport.scale > 1.01
      setOpen(!zoomed && opensKeyboard(focused) && tallest - viewport.height > KEYBOARD_MIN_PX)
    }

    const onResize = () => update(document.activeElement)
    const onFocusIn = (event) => update(event.target)
    // During `focusout` the active element is still the one being left.
    const onFocusOut = (event) => update(event.relatedTarget)

    viewport.addEventListener('resize', onResize)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      viewport.removeEventListener('resize', onResize)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  return open
}
