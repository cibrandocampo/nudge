import { lotExpirySeverity } from './stockSeverity'

/**
 * Partition a stock's lots into reached / soon buckets in a single pass.
 *
 * Lived in `InventoryPage` until T090. The alert content is derived from
 * `stock.lots` directly rather than from a server-side `expiring_lots` field
 * (dropped in T170), and this module is now the only place that reads them
 * for alert purposes.
 *
 * Emptied lots are skipped: a lot kept alive at quantity 0 by `bulk_create`
 * is not something to warn about.
 */
export function lotsByExpirySeverity(stock, today) {
  const reached = []
  const soon = []
  for (const lot of stock.lots ?? []) {
    if (lot.quantity <= 0) continue
    const sev = lotExpirySeverity(lot, today)
    if (sev === 'reached') reached.push(lot)
    else if (sev === 'soon') soon.push(lot)
  }
  return { reached, soon }
}

/**
 * Whether a stock needs the user's attention on either severity axis.
 *
 * The single definition of "in trouble" in the app: the alert banner counts
 * the products it will list with it, and the inventory's Atención filter chip
 * selects with the same function. Two copies would drift the first time a tier
 * is added or a threshold moves.
 */
export function needsAttention(stock) {
  return (
    stock?.stock_severity === 'critical' ||
    stock?.stock_severity === 'low' ||
    stock?.expiry_severity === 'reached' ||
    stock?.expiry_severity === 'soon'
  )
}

/**
 * The worst severity present in a set of stocks: `'danger'`, `'warning'`, or
 * `null` when everything is healthy.
 *
 * Lets a collapsed group still say that something inside needs attention,
 * which is what makes collapsing safe to do. Same vocabulary as the labels
 * above — anything red on either axis is danger, anything amber is warning.
 */
export function worstSeverity(stocks) {
  let warning = false
  for (const stock of stocks ?? []) {
    if (stock?.stock_severity === 'critical' || stock?.expiry_severity === 'reached') return 'danger'
    if (stock?.stock_severity === 'low' || stock?.expiry_severity === 'soon') warning = true
  }
  return warning ? 'warning' : null
}

/**
 * Earliest expiry among a set of lots, which arrive unordered.
 *
 * Plain string comparison is correct here and deliberate: `expiry_date` is an
 * ISO `YYYY-MM-DD` date, so lexicographic order is chronological order, and
 * parsing to `Date` would only add a timezone to get wrong.
 */
function earliestExpiry(lots) {
  return lots.reduce((min, lot) => (min === null || lot.expiry_date < min ? lot.expiry_date : min), null)
}

/**
 * Every stock that needs attention, one entry per stock.
 *
 *   [{ stock, severity: 'danger' | 'warning', labels: [{ key, params, tone }] }]
 *
 * The four alert cards this replaces (T090) emitted one badge **per lot**, so
 * a stock with three expired lots appeared three times and a stock that was
 * both out of stock and expired appeared in two separate blocks. Here a stock
 * is one row however many things are wrong with it, which is what makes each
 * row able to link to that stock's detail page.
 *
 * Labels are descriptors, not text: this module stays free of i18next so it
 * can be tested without a translation runtime. The caller resolves `key` with
 * `params`, formatting any `date` param on the way.
 *
 * `today` is passed in rather than read here so every list on screen judges
 * expiry against the same instant.
 */
export function buildStockAlerts(stocks, today) {
  const alerts = []

  for (const stock of stocks ?? []) {
    // Same gate the Atención chip uses, so the banner's count and the chip's
    // count are the same number by construction. Also skips partitioning the
    // lots of every healthy stock.
    if (!needsAttention(stock)) continue

    const { reached, soon } = lotsByExpirySeverity(stock, today)
    const labels = []
    // The quantity the depletion estimate is built from (T164 excludes
    // expired lots from the burn rate's numerator), so it is the only figure
    // coherent with the "until <date>" tail beside it.
    const qty = stock.quantity_available ?? stock.quantity ?? 0

    if (stock.stock_severity === 'critical') {
      labels.push({ key: 'inventory.alertCriticalStock', params: { qty }, tone: 'danger' })
    }

    // `expiry_severity` is the backend's single verdict, so 'reached' and
    // 'soon' are mutually exclusive by construction: a stock holding one
    // expired lot and one near-future lot is 'reached', and says nothing
    // about the latter. That precedence is the backend's to award.
    if (stock.expiry_severity === 'reached' && reached.length > 0) {
      labels.push({ key: 'inventory.alertExpiryReached', params: { count: reached.length }, tone: 'danger' })
    }

    if (stock.stock_severity === 'low') {
      labels.push(
        stock.estimated_depletion_date
          ? {
              key: 'inventory.alertLowStockUntil',
              params: { qty, date: stock.estimated_depletion_date },
              tone: 'warning',
            }
          : { key: 'inventory.alertLowStock', params: { qty }, tone: 'warning' },
      )
    }

    if (stock.expiry_severity === 'soon' && soon.length > 0) {
      labels.push({
        key: 'inventory.alertExpiringSoon',
        params: { count: soon.length, date: earliestExpiry(soon) },
        tone: 'warning',
      })
    }

    // An expiry severity the lots no longer back leaves nothing to say. The
    // server judges against its own `date.today()` and the client against UTC
    // midnight, so the two can disagree about a lot expiring exactly today.
    // Drop the row rather than render one with a name and no reason.
    if (labels.length === 0) continue

    alerts.push({
      stock,
      severity: labels.some((label) => label.tone === 'danger') ? 'danger' : 'warning',
      labels,
    })
  }

  // Danger before warning, alphabetical within each block — the ordering the
  // four separate cards used to encode through their position on the page.
  return alerts.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'danger' ? -1 : 1) || a.stock.name.localeCompare(b.stock.name),
  )
}
