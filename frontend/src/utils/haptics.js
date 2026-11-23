/**
 * Three short-short-long buzzes: «that could not be done». Unmistakable next to
 * the single 10 ms tick of a swipe reaching its stop, so someone taking their
 * medication notices the refusal without looking at the screen.
 */
export const REFUSED_PATTERN = [70, 60, 70, 60, 160]

/** Felt where the device supports it (not on iOS); silent with reduced motion. */
export function vibrateRefused() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  navigator.vibrate?.(REFUSED_PATTERN)
}

/** The same, when what the server refused is the stock. */
export function vibrateIfOutOfStock(error) {
  if (error?.body?.code === 'insufficient_stock') vibrateRefused()
}
