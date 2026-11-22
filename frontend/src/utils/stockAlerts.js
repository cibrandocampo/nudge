/**
 * Labels for what the regulatory agency says about the stock's medicine.
 *
 * The third axis next to stock and expiry: an active supply problem, a
 * medicine no longer marketed, a suspended or revoked authorisation — states
 * that last, unlike a safety notice, which is news (the push and the product
 * page carry those). Built from the summary's model fields only.
 *
 * Only when there is data: never fetched (`fetched_at` null) or `not_found`
 * says nothing. Any other status keeps the last good data — a refresh in
 * flight (`pending`) or a failed one (`error`) must not make the row blink.
 */
export function regulatoryLabels(stock) {
  const regulatory = stock?.regulatory
  if (!regulatory?.fetched_at || regulatory.fetch_status === 'not_found') return []
  const labels = []
  if (regulatory.supply_severity === 'danger') {
    labels.push({ key: 'inventory.rowSupplyProblem', tone: 'danger' })
  } else if (regulatory.supply_severity === 'warning') {
    labels.push({ key: 'inventory.rowSupplyLimited', tone: 'warning' })
  }
  if (regulatory.marketed === false) {
    labels.push({ key: 'inventory.rowNotMarketed', tone: 'warning' })
  }
  if (regulatory.status === 'suspended') {
    labels.push({ key: 'inventory.rowAuthorizationSuspended', tone: 'danger' })
  } else if (regulatory.status === 'revoked') {
    labels.push({ key: 'inventory.rowAuthorizationRevoked', tone: 'danger' })
  }
  return labels
}

const KNOWN_STOCK_SEVERITIES = new Set(['ok', 'low', 'critical'])

/**
 * The one status of a product: `'danger'`, `'warning'` or `'ok'`, the worst of
 * its stock, its expiry and what the regulatory agency says (T203).
 *
 * Everything that colours or selects a product comes from here (the dot, the
 * Atención filter, a group's severity), so a green dot can never sit next to a
 * red reason. A missing or unknown `stock_severity` (a stale cached snapshot)
 * reads as danger: better a false alarm than a false green on a medicine.
 */
export function stockStatus(stock) {
  const severity = stock?.stock_severity
  if (!KNOWN_STOCK_SEVERITIES.has(severity)) return 'danger'
  const tones = regulatoryLabels(stock).map((label) => label.tone)
  if (
    severity === 'critical' ||
    stock.expiry_severity === 'reached' ||
    (stock.quantity_expired ?? 0) > 0 ||
    tones.includes('danger')
  ) {
    return 'danger'
  }
  if (severity === 'low' || stock.expiry_severity === 'soon' || tones.length > 0) return 'warning'
  return 'ok'
}

/** Whether a product needs the user's attention: anything but `ok`. */
export function needsAttention(stock) {
  return stockStatus(stock) !== 'ok'
}

/**
 * Why a stock needs attention, as the words its inventory row shows:
 *
 *   [{ kind: 'stock' | 'expiry' | 'regulatory', key, params?, tone: 'danger' | 'warning' }]
 *
 * The row replaces the "N products need attention" banner: the Atención chip
 * filters the list, and each row says its own reason, so the reason is where
 * the product is. Every axis of `needsAttention` is covered, but nothing is
 * said twice:
 *
 *   - stock: out of stock is the quantity itself, in red; a depletion date
 *     ("until …") already carries the tint. Only a low or critical stock with
 *     units left and no date gets a word.
 *   - expiry: one word from the backend's single verdict ('reached' outranks
 *     'soon', by construction).
 *   - regulatory: the agency's verdicts, last.
 *
 * Descriptors, not text: the module stays free of i18next.
 */
export function stockRowReasons(stock) {
  const reasons = []
  const quantity = stock?.quantity_available ?? stock?.quantity ?? 0

  if (quantity > 0 && !stock.estimated_depletion_date) {
    if (stock.stock_severity === 'critical') {
      reasons.push({ kind: 'stock', key: 'inventory.rowCriticalStock', tone: 'danger' })
    } else if (stock.stock_severity === 'low') {
      reasons.push({ kind: 'stock', key: 'inventory.rowLowStock', tone: 'warning' })
    }
  }

  // Expired units are counted ("1 expired") when the backend reports them, so
  // the count leaves line 1 — where it squeezed the name — and joins the
  // reasons; with no count, the plain word.
  const expired = stock?.quantity_expired ?? 0
  if (expired > 0) {
    reasons.push({ kind: 'expiry', key: 'inventory.expiredCount', params: { count: expired }, tone: 'danger' })
  } else if (stock?.expiry_severity === 'reached') {
    reasons.push({ kind: 'expiry', key: 'inventory.rowExpiryReached', tone: 'danger' })
  } else if (stock?.expiry_severity === 'soon') {
    reasons.push({ kind: 'expiry', key: 'inventory.rowExpiringSoon', tone: 'warning' })
  }

  for (const label of regulatoryLabels(stock)) reasons.push({ kind: 'regulatory', ...label })
  return reasons
}

/**
 * The worst `stockStatus` in a set of stocks: `'danger'`, `'warning'`, or
 * `null` when everything is healthy.
 */
export function worstSeverity(stocks) {
  const statuses = (stocks ?? []).map(stockStatus)
  if (statuses.includes('danger')) return 'danger'
  return statuses.includes('warning') ? 'warning' : null
}
