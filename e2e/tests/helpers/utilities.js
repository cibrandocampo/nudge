/** `uniqueName('routine')` → `routine-1712505600000`. */
export function uniqueName(prefix) {
  return `${prefix}-${Date.now()}`
}

/** Parse the first integer from a locator's text (e.g. "5 u." → 5). */
export async function readNumericValue(locator) {
  const text = await locator.innerText()
  const match = text.match(/-?\d+/)
  if (!match) throw new Error(`No numeric value in "${text}"`)
  return Number(match[0])
}

/** ISO date string (YYYY-MM-DD) for `daysFromNow` days from today. */
export function formatExpiryDate(daysFromNow) {
  const d = new Date(Date.now() + daysFromNow * 86_400_000)
  return d.toISOString().slice(0, 10)
}
