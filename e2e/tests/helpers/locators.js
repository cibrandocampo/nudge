import { SEED } from './constants.js'

export function routineCard(page, routineKey) {
  const name = SEED.routines[routineKey] ?? routineKey
  return page.getByTestId('routine-card').filter({ hasText: name })
}

export function stockCard(page, stockKey) {
  const name = SEED.stocks[stockKey] ?? stockKey
  return page.getByTestId('product-card').filter({ hasText: name })
}

/**
 * Locator for a History entry, filtered by any combination of
 *   routineKey (SEED.routines key), stockKey (SEED.stocks key), text,
 *   type ('routine' | 'consumption' — via data-entry-type).
 * Entry cards carry `data-testid="history-entry"` (HistoryPage.jsx).
 */
export function historyEntry(page, { routineKey, stockKey, text, type } = {}) {
  const selector = type
    ? `[data-testid="history-entry"][data-entry-type="${type}"]`
    : '[data-testid="history-entry"]'
  let base = page.locator(selector)
  if (routineKey) base = base.filter({ hasText: SEED.routines[routineKey] ?? routineKey })
  if (stockKey) base = base.filter({ hasText: SEED.stocks[stockKey] ?? stockKey })
  if (text) base = base.filter({ hasText: text })
  return base
}
