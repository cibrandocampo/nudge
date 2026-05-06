import { describe, expect, it } from 'vitest'
import shared from '../../styles/shared.module.css'
import {
  borderTokensFromStock,
  iconClassForLot,
  iconClassForStock,
  lotExpirySeverity,
} from '../stockSeverity'

const TODAY = new Date('2026-05-06T00:00:00')

function daysFromToday(days) {
  const d = new Date(TODAY)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

describe('lotExpirySeverity', () => {
  it('returns "none" when expiry_date is null', () => {
    expect(lotExpirySeverity({ expiry_date: null }, TODAY)).toBe('none')
  })

  it('returns "none" when expiry_date is undefined', () => {
    expect(lotExpirySeverity({}, TODAY)).toBe('none')
  })

  it('returns "reached" for an expiry_date in the past', () => {
    expect(lotExpirySeverity({ expiry_date: daysFromToday(-1) }, TODAY)).toBe('reached')
  })

  it('returns "reached" for an expiry_date exactly today', () => {
    expect(lotExpirySeverity({ expiry_date: daysFromToday(0) }, TODAY)).toBe('reached')
  })

  it('returns "soon" for an expiry_date 15 days in the future', () => {
    expect(lotExpirySeverity({ expiry_date: daysFromToday(15) }, TODAY)).toBe('soon')
  })

  it('returns "soon" for an expiry_date 29 days in the future', () => {
    expect(lotExpirySeverity({ expiry_date: daysFromToday(29) }, TODAY)).toBe('soon')
  })

  it('returns "none" for an expiry_date 60 days in the future', () => {
    expect(lotExpirySeverity({ expiry_date: daysFromToday(60) }, TODAY)).toBe('none')
  })
})

describe('borderTokensFromStock — 3-tier, stock-only (T165)', () => {
  it('stock_severity=critical → danger', () => {
    expect(borderTokensFromStock({ stock_severity: 'critical' })).toEqual({
      border: shared.cardBorderDanger,
      dot: shared.dotDanger,
    })
  })

  it('stock_severity=low → warning', () => {
    expect(borderTokensFromStock({ stock_severity: 'low' })).toEqual({
      border: shared.cardBorderWarning,
      dot: shared.dotWarning,
    })
  })

  it('stock_severity=ok → success', () => {
    expect(borderTokensFromStock({ stock_severity: 'ok' })).toEqual({
      border: shared.cardBorderSuccess,
      dot: shared.dotSuccess,
    })
  })

  it('null stock → danger fallback', () => {
    expect(borderTokensFromStock(null)).toEqual({
      border: shared.cardBorderDanger,
      dot: shared.dotDanger,
    })
  })

  it('undefined stock → danger fallback', () => {
    expect(borderTokensFromStock(undefined)).toEqual({
      border: shared.cardBorderDanger,
      dot: shared.dotDanger,
    })
  })

  it('unknown stock_severity (e.g. cached "out" from old contract) → danger', () => {
    expect(borderTokensFromStock({ stock_severity: 'out' })).toEqual({
      border: shared.cardBorderDanger,
      dot: shared.dotDanger,
    })
  })

  // Documents the no-worst-of-two contract: expiry_severity is ignored.
  it('ignores expiry_severity=soon when stock_severity is ok → still success', () => {
    expect(borderTokensFromStock({ stock_severity: 'ok', expiry_severity: 'soon' })).toEqual({
      border: shared.cardBorderSuccess,
      dot: shared.dotSuccess,
    })
  })

  it('ignores expiry_severity=reached when stock_severity is ok → still success', () => {
    expect(borderTokensFromStock({ stock_severity: 'ok', expiry_severity: 'reached' })).toEqual({
      border: shared.cardBorderSuccess,
      dot: shared.dotSuccess,
    })
  })
})

describe('iconClassForLot', () => {
  it('returns null for a lot without expiry_date', () => {
    expect(iconClassForLot({ expiry_date: null }, TODAY)).toBe(null)
  })

  it('returns iconDanger for a lot expiring today', () => {
    expect(iconClassForLot({ expiry_date: daysFromToday(0) }, TODAY)).toBe(shared.iconDanger)
  })

  it('returns iconWarning for a lot expiring in 15 days', () => {
    expect(iconClassForLot({ expiry_date: daysFromToday(15) }, TODAY)).toBe(shared.iconWarning)
  })

  it('returns null for a lot expiring in 60 days', () => {
    expect(iconClassForLot({ expiry_date: daysFromToday(60) }, TODAY)).toBe(null)
  })
})

describe('iconClassForStock — 3-tier, stock-only (T165)', () => {
  it('returns null when stock is undefined', () => {
    expect(iconClassForStock(undefined)).toBe(null)
  })

  it('returns null when stock is null', () => {
    expect(iconClassForStock(null)).toBe(null)
  })

  it('stock_severity=critical → iconDanger', () => {
    expect(iconClassForStock({ stock_severity: 'critical' })).toBe(shared.iconDanger)
  })

  it('stock_severity=low → iconWarning', () => {
    expect(iconClassForStock({ stock_severity: 'low' })).toBe(shared.iconWarning)
  })

  it('stock_severity=ok → iconSuccess', () => {
    expect(iconClassForStock({ stock_severity: 'ok' })).toBe(shared.iconSuccess)
  })

  it('returns null when stock_severity is missing', () => {
    expect(iconClassForStock({})).toBe(null)
  })

  it('returns null for an unknown stock_severity (cold cache "out" from old contract)', () => {
    expect(iconClassForStock({ stock_severity: 'out' })).toBe(null)
  })

  // Documents the no-worst-of-two contract.
  it('ignores expiry_severity=soon when stock_severity is ok → still iconSuccess', () => {
    expect(iconClassForStock({ stock_severity: 'ok', expiry_severity: 'soon' })).toBe(shared.iconSuccess)
  })

  it('ignores expiry_severity=reached when stock_severity is ok → still iconSuccess', () => {
    expect(iconClassForStock({ stock_severity: 'ok', expiry_severity: 'reached' })).toBe(shared.iconSuccess)
  })
})
