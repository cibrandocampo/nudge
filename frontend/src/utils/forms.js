import { flushSync } from 'react-dom'

const CONTROL =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'

/**
 * Whether a form may take the focus on its own. On a touch screen that opens
 * the keyboard over the form's buttons before the user asked to type (UX-027).
 */
export function shouldAutoFocus() {
  return window.matchMedia?.('(pointer: fine)')?.matches === true
}

/**
 * Focus and scroll to the first thing marked `data-invalid="true"` inside
 * `root`: a control, a wrapper holding one (`FormField` marks itself) or, for
 * an error with no single field, its message with `tabIndex={-1}`.
 */
export function focusFirstInvalid(root) {
  const marked = root?.querySelector('[data-invalid="true"]')
  if (!marked) return
  const target = marked.matches(CONTROL) ? marked : (marked.querySelector(CONTROL) ?? marked)
  target.focus({ preventScroll: true })
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  target.scrollIntoView?.({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
}

/**
 * After a failed submit: render the errors now, then take the user to the first
 * one. Synchronous because a repeated, identical error renders nothing new, so
 * an effect would not run and the focus would stay on the button.
 */
export function showInvalid(root, applyErrors) {
  flushSync(applyErrors)
  focusFirstInvalid(root)
}
