const COLLAPSED_KEY = 'inventory_collapsed_groups'
const SCROLL_KEY = 'inventory_scroll_y'

/**
 * Which inventory sections the user has folded away.
 *
 * Persisted because collapsing was previously component state: opening a
 * product and coming back expanded everything again, so folding never paid off
 * and the feature was effectively dead. One key holding `{ [sectionKey]: true }`
 * rather than a key per group, so clearing the preference is one removal and
 * the storage cannot accumulate orphans indefinitely.
 *
 * Every read is defensive. Storage can be disabled (private mode, blocked
 * cookies) and the value can be anything if a user or another tab wrote
 * nonsense — none of which is worth breaking the page for. An unreadable
 * preference means "nothing collapsed", which is the safe default: the user
 * sees their stock rather than an empty screen.
 */
export function readCollapsedGroups(validKeys) {
  let parsed
  try {
    parsed = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? 'null')
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

  // Drop entries for sections that no longer exist — a deleted group must not
  // keep a live one folded by colliding on a recycled id.
  const allowed = validKeys && new Set(validKeys.map(String))
  const result = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== true) continue
    if (allowed && !allowed.has(key)) continue
    result[key] = true
  }
  return result
}

/** Persist the collapsed map, keeping only the sections that still exist. */
export function writeCollapsedGroups(collapsed, validKeys) {
  const allowed = validKeys && new Set(validKeys.map(String))
  const pruned = {}
  for (const [key, value] of Object.entries(collapsed ?? {})) {
    if (value !== true) continue
    if (allowed && !allowed.has(key)) continue
    pruned[key] = true
  }
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(pruned))
  } catch {
    // Nothing to do: the choice simply will not survive this session.
  }
}

/**
 * Where the user was in the inventory when they left it.
 *
 * `sessionStorage`, not `localStorage`: a scroll offset is meaningful for as
 * long as the list is the same, and restoring yesterday's position into a list
 * that has changed underneath would be worse than starting at the top.
 *
 * The caller must track the offset while the route is live and hand it over on
 * unmount. Reading `window.scrollY` at teardown records 0: navigating away
 * fires a reset-to-0 scroll that lands after the URL has changed but before
 * the page is torn down.
 *
 * Deliberately **not** solved with `navigate(-1)` on the detail page's back
 * link. There are three ways into a stock detail — the list, a routine detail,
 * and the stock form after saving — and going back from the form would return
 * to the edit form the user just submitted. Saving and restoring the offset
 * works from all three, and from the alert banner's links too.
 */
export function readInventoryScroll() {
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY)
    const value = Number(raw)
    return raw !== null && Number.isFinite(value) && value >= 0 ? value : 0
  } catch {
    return 0
  }
}

export function writeInventoryScroll(y) {
  try {
    sessionStorage.setItem(SCROLL_KEY, String(Math.max(0, Math.round(y || 0))))
  } catch {
    // As above: not worth failing an unmount over.
  }
}
