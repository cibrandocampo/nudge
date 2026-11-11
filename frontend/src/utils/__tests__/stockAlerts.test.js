import { describe, expect, it } from 'vitest'
import { buildStockAlerts, lotsByExpirySeverity, needsAttention, regulatoryLabels, worstSeverity } from '../stockAlerts'

// UTC-midnight today, the same instant every caller of these helpers uses.
const TODAY = new Date(new Date().toISOString().slice(0, 10))
const daysFromNow = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
const PAST = '2026-04-20'
const SOON = daysFromNow(15)
const SOONER = daysFromNow(3)
const FAR = daysFromNow(400)

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

const keys = (entry) => entry.labels.map((l) => l.key)

describe('lotsByExpirySeverity', () => {
  it('buckets lots by their own expiry against today', () => {
    const { reached, soon } = lotsByExpirySeverity(
      stock({
        lots: [
          { id: 1, quantity: 1, expiry_date: PAST },
          { id: 2, quantity: 2, expiry_date: SOON },
          { id: 3, quantity: 3, expiry_date: FAR },
          { id: 4, quantity: 4, expiry_date: null },
        ],
      }),
      TODAY,
    )
    expect(reached.map((l) => l.id)).toEqual([1])
    expect(soon.map((l) => l.id)).toEqual([2])
  })

  it('skips emptied lots, which are nothing to warn about', () => {
    const { reached } = lotsByExpirySeverity(stock({ lots: [{ id: 1, quantity: 0, expiry_date: PAST }] }), TODAY)
    expect(reached).toEqual([])
  })

  it('treats a missing lots array as no lots', () => {
    expect(lotsByExpirySeverity({ name: 'x' }, TODAY)).toEqual({ reached: [], soon: [] })
  })
})

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

describe('buildStockAlerts', () => {
  it('returns nothing when every stock is healthy', () => {
    expect(buildStockAlerts([stock(), stock({ id: 2 })], TODAY)).toEqual([])
  })

  it('treats a missing stock list as empty', () => {
    expect(buildStockAlerts(undefined, TODAY)).toEqual([])
  })

  it('reports critical stock with the available quantity', () => {
    const [entry] = buildStockAlerts([stock({ stock_severity: 'critical', quantity: 3, quantity_available: 0 })], TODAY)
    expect(entry.severity).toBe('danger')
    expect(entry.labels).toEqual([{ key: 'inventory.alertCriticalStock', params: { qty: 0 }, tone: 'danger' }])
  })

  it('falls back to quantity, then to zero, when availability is absent', () => {
    const [withQuantity] = buildStockAlerts(
      [stock({ stock_severity: 'critical', quantity: 7, quantity_available: undefined })],
      TODAY,
    )
    expect(withQuantity.labels[0].params.qty).toBe(7)

    const [withNeither] = buildStockAlerts(
      [stock({ stock_severity: 'critical', quantity: undefined, quantity_available: undefined })],
      TODAY,
    )
    expect(withNeither.labels[0].params.qty).toBe(0)
  })

  it('counts expired lots once per stock instead of once per lot', () => {
    const [entry] = buildStockAlerts(
      [
        stock({
          expiry_severity: 'reached',
          lots: [
            { id: 1, quantity: 1, expiry_date: PAST },
            { id: 2, quantity: 2, expiry_date: PAST },
            { id: 3, quantity: 3, expiry_date: PAST },
          ],
        }),
      ],
      TODAY,
    )
    expect(entry.labels).toEqual([{ key: 'inventory.alertExpiryReached', params: { count: 3 }, tone: 'danger' }])
  })

  it('reports low stock with the depletion date when there is one', () => {
    const [entry] = buildStockAlerts(
      [stock({ stock_severity: 'low', quantity_available: 4, estimated_depletion_date: '2026-09-12' })],
      TODAY,
    )
    expect(entry.severity).toBe('warning')
    expect(entry.labels).toEqual([
      { key: 'inventory.alertLowStockUntil', params: { qty: 4, date: '2026-09-12' }, tone: 'warning' },
    ])
  })

  it('reports low stock without a date when none is known', () => {
    const [entry] = buildStockAlerts(
      [stock({ stock_severity: 'low', quantity_available: 4, estimated_depletion_date: null })],
      TODAY,
    )
    expect(entry.labels).toEqual([{ key: 'inventory.alertLowStock', params: { qty: 4 }, tone: 'warning' }])
  })

  it.each([
    ['nearest last', [SOON, SOONER]],
    ['nearest first', [SOONER, SOON]],
  ])('reports the nearest expiry among the soon lots (%s)', (_label, dates) => {
    const [entry] = buildStockAlerts(
      [
        stock({
          expiry_severity: 'soon',
          lots: dates.map((expiry_date, i) => ({ id: i + 1, quantity: 1, expiry_date })),
        }),
      ],
      TODAY,
    )
    expect(entry.labels).toEqual([
      { key: 'inventory.alertExpiringSoon', params: { count: 2, date: SOONER }, tone: 'warning' },
    ])
  })

  it('gives a stock with two problems one entry carrying both labels', () => {
    const alerts = buildStockAlerts(
      [
        stock({
          name: 'Ibuprofen',
          stock_severity: 'critical',
          quantity_available: 0,
          expiry_severity: 'reached',
          lots: [{ id: 99, quantity: 1, expiry_date: PAST }],
        }),
      ],
      TODAY,
    )
    expect(alerts).toHaveLength(1)
    expect(keys(alerts[0])).toEqual(['inventory.alertCriticalStock', 'inventory.alertExpiryReached'])
  })

  it('takes danger for the whole entry when only one label is danger', () => {
    const [entry] = buildStockAlerts(
      [
        stock({
          stock_severity: 'low',
          expiry_severity: 'reached',
          lots: [{ id: 1, quantity: 1, expiry_date: PAST }],
        }),
      ],
      TODAY,
    )
    expect(entry.severity).toBe('danger')
    expect(keys(entry)).toEqual(['inventory.alertExpiryReached', 'inventory.alertLowStock'])
  })

  it("says nothing about future lots when the backend awarded 'reached' precedence", () => {
    // `expiry_severity` is one verdict, so a stock holding both an expired lot
    // and a near-future one is 'reached' only — the soon label must not fire.
    const [entry] = buildStockAlerts(
      [
        stock({
          expiry_severity: 'reached',
          lots: [
            { id: 1, quantity: 1, expiry_date: PAST },
            { id: 2, quantity: 2, expiry_date: SOON },
          ],
        }),
      ],
      TODAY,
    )
    expect(keys(entry)).toEqual(['inventory.alertExpiryReached'])
  })

  it('drops a stock whose expiry severity no lot backs, rather than showing an empty row', () => {
    // Server and client can disagree about a lot expiring exactly today: the
    // server judges on its own `date.today()`, the client on UTC midnight.
    expect(buildStockAlerts([stock({ expiry_severity: 'reached', lots: [] })], TODAY)).toEqual([])
    expect(buildStockAlerts([stock({ expiry_severity: 'soon', lots: [] })], TODAY)).toEqual([])
  })

  it('orders danger before warning, alphabetically within each block', () => {
    const alerts = buildStockAlerts(
      [
        stock({ id: 1, name: 'Zinc', stock_severity: 'low' }),
        stock({ id: 2, name: 'Aspirin', stock_severity: 'low' }),
        stock({ id: 3, name: 'Warfarin', stock_severity: 'critical' }),
        stock({ id: 4, name: 'Bandages', stock_severity: 'critical' }),
      ],
      TODAY,
    )
    expect(alerts.map((a) => a.stock.name)).toEqual(['Bandages', 'Warfarin', 'Aspirin', 'Zinc'])
  })
})

// ── Regulatory alerts (T119) ────────────────────────────────────────────────

const regulatory = (over = {}) => ({
  fetch_status: 'ok',
  fetched_at: '2026-11-10T01:00:00Z',
  supply_severity: null,
  marketed: true,
  status: 'authorised',
  ...over,
})

const labelOf = (over) => regulatoryLabels(stock({ regulatory: regulatory(over) }))

describe('regulatoryLabels', () => {
  it('a healthy medicine says nothing', () => {
    expect(labelOf({})).toEqual([])
  })

  it('an active supply problem is danger', () => {
    expect(labelOf({ supply_severity: 'danger' })).toEqual([
      { key: 'inventory.alertSupplyProblem', params: {}, tone: 'danger' },
    ])
  })

  it('a limited supply is warning', () => {
    expect(labelOf({ supply_severity: 'warning' })).toEqual([
      { key: 'inventory.alertSupplyLimited', params: {}, tone: 'warning' },
    ])
  })

  it('a medicine no longer marketed is warning', () => {
    expect(labelOf({ marketed: false })).toEqual([{ key: 'inventory.alertNotMarketed', params: {}, tone: 'warning' }])
  })

  it('an unknown marketing state says nothing', () => {
    expect(labelOf({ marketed: null })).toEqual([])
  })

  it('a suspended authorisation is danger', () => {
    expect(labelOf({ status: 'suspended' })).toEqual([
      { key: 'inventory.alertAuthorizationSuspended', params: {}, tone: 'danger' },
    ])
  })

  it('a revoked authorisation is danger', () => {
    expect(labelOf({ status: 'revoked' })).toEqual([
      { key: 'inventory.alertAuthorizationRevoked', params: {}, tone: 'danger' },
    ])
  })

  it('several verdicts come in a fixed order', () => {
    const keysOf = labelOf({ supply_severity: 'warning', marketed: false, status: 'revoked' }).map((l) => l.key)
    expect(keysOf).toEqual([
      'inventory.alertSupplyLimited',
      'inventory.alertNotMarketed',
      'inventory.alertAuthorizationRevoked',
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

  it('a regulatory-only stock gets its own banner entry', () => {
    const [entry] = buildStockAlerts([insulin], TODAY)
    expect(entry.severity).toBe('danger')
    expect(keys(entry)).toEqual(['inventory.alertSupplyProblem'])
  })

  it('stock and expiry labels keep their order and come first', () => {
    const [entry] = buildStockAlerts(
      [
        stock({
          stock_severity: 'critical',
          quantity_available: 0,
          expiry_severity: 'reached',
          lots: [{ id: 1, quantity: 1, expiry_date: PAST }],
          regulatory: regulatory({ supply_severity: 'warning', status: 'suspended' }),
        }),
      ],
      TODAY,
    )
    expect(keys(entry)).toEqual([
      'inventory.alertCriticalStock',
      'inventory.alertExpiryReached',
      'inventory.alertSupplyLimited',
      'inventory.alertAuthorizationSuspended',
    ])
  })
})
