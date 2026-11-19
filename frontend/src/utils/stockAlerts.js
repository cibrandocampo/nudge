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

/**
 * Whether a stock needs the user's attention on any axis: stock, expiry or
 * what the regulatory agency says (`regulatoryLabels`).
 *
 * The single definition of "in trouble" in the app: the inventory's Atención
 * filter chip selects with it, and `stockRowReasons` says why on each row it
 * selects. Two copies would drift the first time a tier is added or a
 * threshold moves.
 */
export function needsAttention(stock) {
  return (
    stock?.stock_severity === 'critical' ||
    stock?.stock_severity === 'low' ||
    stock?.expiry_severity === 'reached' ||
    stock?.expiry_severity === 'soon' ||
    regulatoryLabels(stock).length > 0
  )
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
 * The worst severity present in a set of stocks: `'danger'`, `'warning'`, or
 * `null` when everything is healthy.
 *
 * Lets a collapsed group still say that something inside needs attention,
 * which is what makes collapsing safe to do. Same vocabulary as the labels
 * above — anything red on any axis is danger, anything amber is warning.
 */
export function worstSeverity(stocks) {
  let warning = false
  for (const stock of stocks ?? []) {
    if (stock?.stock_severity === 'critical' || stock?.expiry_severity === 'reached') return 'danger'
    if (stock?.stock_severity === 'low' || stock?.expiry_severity === 'soon') warning = true
    const tones = regulatoryLabels(stock).map((label) => label.tone)
    if (tones.includes('danger')) return 'danger'
    if (tones.length > 0) warning = true
  }
  return warning ? 'warning' : null
}
