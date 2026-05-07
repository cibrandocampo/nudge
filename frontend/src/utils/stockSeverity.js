import shared from '../styles/shared.module.css'

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

// Stock-only border tokens (T165). The backend's `stock_severity` integrates
// the rules from `docs/plans/stock-severity-revised.md` (Tipo 1 + Tipo 2,
// `quantity_available`-based depletion). The frontend just maps tier → tokens.
//
// `expiry_severity` is intentionally NOT consulted here — the per-lot icon
// tint and per-lot expiry date tint carry the expiry signal. Bundling expiry
// into the stock-level border was the worst-of-two model from T159–T162;
// the revised plan reverts that coupling.
//
// Default branch covers: null/undefined stock, and any unknown value (e.g.
// a stale cached snapshot serialised under the old `'out'` contract). Render
// danger so the user notices the anomaly.
export function borderTokensFromStock(stock) {
  switch (stock?.stock_severity) {
    case 'critical':
      return { border: shared.cardBorderDanger, dot: shared.dotDanger }
    case 'low':
      return { border: shared.cardBorderWarning, dot: shared.dotWarning }
    case 'ok':
      return { border: shared.cardBorderSuccess, dot: shared.dotSuccess }
    default:
      return { border: shared.cardBorderDanger, dot: shared.dotDanger }
  }
}

export function iconClassForLot(lot, today) {
  const sev = lotExpirySeverity(lot, today)
  if (sev === 'reached') return shared.iconDanger
  if (sev === 'soon') return shared.iconWarning
  return null
}

// Stock-only icon class (T165). Same rationale as `borderTokensFromStock`:
// `expiry_severity` is per-lot territory and not consumed here. Default
// branch returns null (no tint) for cold caches / unknown values — keeps
// the badge neutral instead of forcing danger like the border helper.
export function iconClassForStock(stock) {
  switch (stock?.stock_severity) {
    case 'critical':
      return shared.iconDanger
    case 'low':
      return shared.iconWarning
    case 'ok':
      return shared.iconSuccess
    default:
      return null
  }
}
