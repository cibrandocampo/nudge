const LEGACY_COLLAPSED_KEY = 'inventory_collapsed_groups'
const FILTER_KEY = 'inventory_filter'
const SCROLL_KEY = 'inventory_scroll_y'

/**
 * Forget the folded sections of the old grouped list. Sections are gone, so the
 * stored value would otherwise stay on the device for ever.
 */
export function clearLegacyInventoryPrefs() {
  try {
    localStorage.removeItem(LEGACY_COLLAPSED_KEY)
  } catch {
    // Storage disabled: there is nothing stored to forget.
  }
}

/**
 * The filter chosen in this session, so coming back from a product keeps it.
 * `sessionStorage`: opening the app again starts from the default view.
 */
export function readInventoryFilter() {
  try {
    return sessionStorage.getItem(FILTER_KEY)
  } catch {
    return null
  }
}

export function writeInventoryFilter(chipId) {
  try {
    sessionStorage.setItem(FILTER_KEY, chipId)
  } catch {
    // Not worth failing a tap over: the filter still applies on screen.
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
