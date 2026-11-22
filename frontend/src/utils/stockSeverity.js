import cards from '../styles/cards.module.css'
import { stockStatus } from './stockAlerts'
// Tri-state lot expiry severity derived from the lot's own expiry_date.
// Used by per-lot icon tint and (after T166/T167) per-lot expiry date tint.
// Returned values match the data-expiring attribute on lot rows.
export function lotExpirySeverity(lot, today) {
  if (lot.expiry_date == null) return 'none'
  const expiry = new Date(lot.expiry_date)
  if (expiry <= today) return 'reached'
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() + 30)
  if (expiry < cutoff) return 'soon'
  return 'none'
}

// Dot and border of a product: its one status (`stockStatus`, T203), the worst
// of stock, expiry and the regulatory agency. An unknown status renders danger,
// so the user notices the anomaly.
const STATUS_TOKENS = {
  danger: { border: cards.cardBorderDanger, dot: cards.dotDanger },
  warning: { border: cards.cardBorderWarning, dot: cards.dotWarning },
  ok: { border: cards.cardBorderSuccess, dot: cards.dotSuccess },
}

export function borderTokensFromStock(stock) {
  return STATUS_TOKENS[stockStatus(stock)]
}

export function iconClassForLot(lot, today) {
  const sev = lotExpirySeverity(lot, today)
  if (sev === 'reached') return cards.iconDanger
  if (sev === 'soon') return cards.iconWarning
  return null
}

// Stock-only icon class (T165). Same rationale as `borderTokensFromStock`:
// `expiry_severity` is per-lot territory and not consumed here. Only a
// problem gets a tint (T106): `ok`, cold caches and unknown values all stay
// neutral, so colour on the stock line always means something is wrong.
export function iconClassForStock(stock) {
  switch (stock?.stock_severity) {
    case 'critical':
      return cards.iconDanger
    case 'low':
      return cards.iconWarning
    default:
      return null
  }
}
