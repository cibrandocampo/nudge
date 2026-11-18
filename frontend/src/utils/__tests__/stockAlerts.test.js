import { describe, expect, it } from 'vitest'
import { needsAttention, regulatoryLabels, stockRowReasons, worstSeverity } from '../stockAlerts'

const stock = (over = {}) => ({
  id: 1,
  name: 'Water filter',
  quantity: 5,
  quantity_available: 5,
  stock_severity: 'ok',
  expiry_severity: 'none',
  estimated_depletion_date: null,
  lots: [],
  ...over,
})

const regulatory = (over = {}) => ({
  fetch_status: 'ok',
  fetched_at: '2026-11-10T01:00:00Z',
  supply_severity: null,
  marketed: true,
  status: 'authorised',
  ...over,
})

const labelOf = (over) => regulatoryLabels(stock({ regulatory: regulatory(over) }))
const reasonKeys = (over) => stockRowReasons(stock(over)).map((r) => r.key)

describe('worstSeverity', () => {
  it('reports nothing for an empty or healthy set', () => {
    expect(worstSeverity([])).toBeNull()
    expect(worstSeverity(undefined)).toBeNull()
    expect(worstSeverity([stock()])).toBeNull()
  })

  it.each([
    ['critical stock', { stock_severity: 'critical' }],
    ['an expired batch', { expiry_severity: 'reached' }],
  ])('reports danger for %s', (_label, over) => {
    expect(worstSeverity([stock(), stock(over)])).toBe('danger')
  })

  it.each([
    ['low stock', { stock_severity: 'low' }],
    ['a batch expiring soon', { expiry_severity: 'soon' }],
  ])('reports warning for %s', (_label, over) => {
    expect(worstSeverity([stock(), stock(over)])).toBe('warning')
  })

  it('lets danger outrank warning whichever order they appear in', () => {
    expect(worstSeverity([stock({ stock_severity: 'low' }), stock({ stock_severity: 'critical' })])).toBe('danger')
    expect(worstSeverity([stock({ stock_severity: 'critical' }), stock({ stock_severity: 'low' })])).toBe('danger')
  })
})

// ── Regulatory alerts (T119) ────────────────────────────────────────────────

describe('regulatoryLabels', () => {
  it('a healthy medicine says nothing', () => {
    expect(labelOf({})).toEqual([])
  })

  it('an active supply problem is danger', () => {
    expect(labelOf({ supply_severity: 'danger' })).toEqual([{ key: 'inventory.rowSupplyProblem', tone: 'danger' }])
  })

  it('a limited supply is warning', () => {
    expect(labelOf({ supply_severity: 'warning' })).toEqual([{ key: 'inventory.rowSupplyLimited', tone: 'warning' }])
  })

  it('a medicine no longer marketed is warning', () => {
    expect(labelOf({ marketed: false })).toEqual([{ key: 'inventory.rowNotMarketed', tone: 'warning' }])
  })

  it('an unknown marketing state says nothing', () => {
    expect(labelOf({ marketed: null })).toEqual([])
  })

  it('a suspended authorisation is danger', () => {
    expect(labelOf({ status: 'suspended' })).toEqual([{ key: 'inventory.rowAuthorizationSuspended', tone: 'danger' }])
  })

  it('a revoked authorisation is danger', () => {
    expect(labelOf({ status: 'revoked' })).toEqual([{ key: 'inventory.rowAuthorizationRevoked', tone: 'danger' }])
  })

  it('several verdicts come in a fixed order', () => {
    const keysOf = labelOf({ supply_severity: 'warning', marketed: false, status: 'revoked' }).map((l) => l.key)
    expect(keysOf).toEqual([
      'inventory.rowSupplyLimited',
      'inventory.rowNotMarketed',
      'inventory.rowAuthorizationRevoked',
    ])
  })

  it('no data means no alert: never fetched, not found, or no regulatory link', () => {
    expect(labelOf({ supply_severity: 'danger', fetched_at: null })).toEqual([])
    expect(labelOf({ supply_severity: 'danger', fetch_status: 'not_found' })).toEqual([])
    expect(regulatoryLabels(stock({ regulatory: null }))).toEqual([])
    expect(regulatoryLabels(stock())).toEqual([])
    expect(regulatoryLabels(undefined)).toEqual([])
  })

  it('a refresh in flight or a failed one keeps the last good verdict', () => {
    for (const fetch_status of ['pending', 'error']) {
      expect(labelOf({ supply_severity: 'danger', fetch_status })).toHaveLength(1)
    }
  })
})

describe('regulatory alerts in the shared gates', () => {
  const insulin = stock({ name: 'Insulin', regulatory: regulatory({ supply_severity: 'danger' }) })

  it('a regulatory alert alone makes a stock need attention', () => {
    expect(needsAttention(insulin)).toBe(true)
    expect(needsAttention(stock({ regulatory: regulatory() }))).toBe(false)
  })

  it('worstSeverity rises to danger with an active supply problem', () => {
    expect(worstSeverity([stock(), insulin])).toBe('danger')
  })

  it('worstSeverity is warning with a regulatory warning only', () => {
    expect(worstSeverity([stock({ regulatory: regulatory({ marketed: false }) })])).toBe('warning')
  })

  it('a regulatory danger still outranks an earlier warning', () => {
    expect(worstSeverity([stock({ stock_severity: 'low' }), insulin])).toBe('danger')
  })
})

// ── Why a row needs attention (replaces the inventory banner) ───────────────

describe('stockRowReasons', () => {
  it('a healthy stock gives no reason', () => {
    expect(stockRowReasons(stock())).toEqual([])
  })

  it('out of stock gives no word: the red quantity says it', () => {
    expect(reasonKeys({ quantity: 0, quantity_available: 0, stock_severity: 'critical' })).toEqual([])
  })

  it('falls back to quantity when availability is absent', () => {
    expect(reasonKeys({ quantity_available: undefined, quantity: 0, stock_severity: 'critical' })).toEqual([])
    expect(reasonKeys({ quantity_available: undefined, quantity: 2, stock_severity: 'critical' })).toEqual([
      'inventory.rowCriticalStock',
    ])
  })

  it.each([
    ['critical', 'inventory.rowCriticalStock', 'danger'],
    ['low', 'inventory.rowLowStock', 'warning'],
  ])('%s stock with units left and no date gets a word', (severity, key, tone) => {
    expect(stockRowReasons(stock({ stock_severity: severity, quantity_available: 2 }))).toEqual([
      { kind: 'stock', key, tone },
    ])
  })

  it('a dated depletion already carries the tint, so the stock word is left out', () => {
    expect(reasonKeys({ stock_severity: 'low', estimated_depletion_date: '2026-12-01' })).toEqual([])
  })

  it.each([
    ['reached', 'inventory.rowExpiryReached', 'danger'],
    ['soon', 'inventory.rowExpiringSoon', 'warning'],
  ])('expiry %s is one word', (severity, key, tone) => {
    expect(stockRowReasons(stock({ expiry_severity: severity }))).toEqual([{ kind: 'expiry', key, tone }])
  })

  it('counts expired units when the backend reports them, instead of the plain word', () => {
    expect(stockRowReasons(stock({ expiry_severity: 'reached', quantity_expired: 2 }))).toEqual([
      { kind: 'expiry', key: 'inventory.expiredCount', params: { count: 2 }, tone: 'danger' },
    ])
  })

  it('stock, then expiry, then the agency, each said once', () => {
    expect(
      reasonKeys({
        stock_severity: 'low',
        quantity_available: 1,
        expiry_severity: 'reached',
        regulatory: regulatory({ supply_severity: 'danger', marketed: false }),
      }),
    ).toEqual([
      'inventory.rowLowStock',
      'inventory.rowExpiryReached',
      'inventory.rowSupplyProblem',
      'inventory.rowNotMarketed',
    ])
  })

  it('every stock the Atención chip selects says something (reason, or the red zero)', () => {
    const selected = [
      stock({ stock_severity: 'critical', quantity: 0, quantity_available: 0 }),
      stock({ stock_severity: 'critical', quantity_available: 1 }),
      stock({ stock_severity: 'low', estimated_depletion_date: '2026-12-01' }),
      stock({ stock_severity: 'low' }),
      stock({ expiry_severity: 'soon' }),
      stock({ expiry_severity: 'reached' }),
      stock({ regulatory: regulatory({ status: 'revoked' }) }),
    ]
    for (const st of selected) {
      expect(needsAttention(st)).toBe(true)
      const quantity = st.quantity_available ?? st.quantity
      const saysSomething = stockRowReasons(st).length > 0 || quantity === 0 || Boolean(st.estimated_depletion_date)
      expect(saysSomething).toBe(true)
    }
  })
})
