import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import {
  allocateFromGroup,
  consumptionOrder,
  expiryToday,
  findCachedStock,
  groupLots,
  lotsForSelection,
  needsLotChoice,
  routineLotDecision,
} from '../lotsForSelection'

// A fixed today: every expiry below is read against it, never the clock.
const TODAY = new Date('2026-06-01')
const ids = (lots) => lots.map((lot) => lot.id)
const keys = (groups) => groups.map((g) => g.key)

describe('expiryToday', () => {
  it('is midnight UTC of the current date', () => {
    expect(expiryToday(new Date('2026-06-01T23:30:00Z')).toISOString()).toBe('2026-06-01T00:00:00.000Z')
  })

  it('reads the clock when no instant is given', () => {
    expect(expiryToday().toISOString()).toBe(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)
  })
})

// One test per rule of the order, which replicates `Stock.consumable_lots()`.
describe('consumptionOrder', () => {
  it('returns an empty array when handed something that is not an array', () => {
    expect(consumptionOrder(null, TODAY)).toEqual([])
  })

  it('leaves out an expired lot', () => {
    const lots = [
      { id: 1, quantity: 3, expiry_date: '2026-05-31' },
      { id: 2, quantity: 3, expiry_date: '2026-07-01' },
    ]
    expect(ids(consumptionOrder(lots, TODAY))).toEqual([2])
  })

  it('leaves out a lot that expires today', () => {
    const lots = [
      { id: 1, quantity: 3, expiry_date: '2026-06-01' },
      { id: 2, quantity: 3, expiry_date: '2026-06-02' },
    ]
    expect(ids(consumptionOrder(lots, TODAY))).toEqual([2])
  })

  it('leaves out an empty lot, and one with no quantity', () => {
    const lots = [
      { id: 1, quantity: 0, expiry_date: null },
      { id: 2, expiry_date: null },
      { id: 3, quantity: 1, expiry_date: null },
    ]
    expect(ids(consumptionOrder(lots, TODAY))).toEqual([3])
  })

  it('takes the soonest expiry first and an undated lot last', () => {
    const lots = [
      { id: 1, quantity: 3, expiry_date: null },
      { id: 2, quantity: 3, expiry_date: '2027-01-01' },
      { id: 3, quantity: 3, expiry_date: '2026-09-01' },
    ]
    expect(ids(consumptionOrder(lots, TODAY))).toEqual([3, 2, 1])
  })

  it('puts an undated lot last whichever side of the comparison it is on', () => {
    const lots = [
      { id: 1, quantity: 3, expiry_date: '2027-01-01' },
      { id: 2, quantity: 3, expiry_date: null },
    ]
    expect(ids(consumptionOrder(lots, TODAY))).toEqual([1, 2])
    expect(ids(consumptionOrder([...lots].reverse(), TODAY))).toEqual([1, 2])
  })

  it('breaks an expiry tie by lot number', () => {
    const lots = [
      { id: 1, quantity: 3, expiry_date: '2027-01-01', lot_number: 'B' },
      { id: 2, quantity: 3, expiry_date: '2027-01-01', lot_number: 'A' },
      { id: 3, quantity: 3, expiry_date: '2027-01-01' },
    ]
    // No number sorts first, as the backend's empty string does.
    expect(ids(consumptionOrder(lots, TODAY))).toEqual([3, 2, 1])
  })

  it('takes the opened box before a full one of the same lot', () => {
    const lots = [
      { id: 1, quantity: 10, expiry_date: '2027-01-01', lot_number: 'A', created_at: '2026-01-01' },
      { id: 2, quantity: 4, expiry_date: '2027-01-01', lot_number: 'A', created_at: '2026-02-01' },
    ]
    expect(ids(consumptionOrder(lots, TODAY))).toEqual([2, 1])
  })

  it('breaks a full tie by created_at, an unknown one first', () => {
    const lots = [
      { id: 1, quantity: 1, expiry_date: '2027-01-01', lot_number: 'A', created_at: '2026-02-01' },
      { id: 2, quantity: 1, expiry_date: '2027-01-01', lot_number: 'A', created_at: '2026-01-01' },
      { id: 3, quantity: 1, expiry_date: '2027-01-01', lot_number: 'A' },
    ]
    expect(ids(consumptionOrder(lots, TODAY))).toEqual([3, 2, 1])
  })

  it('does not reorder the array it was given', () => {
    const lots = [
      { id: 1, quantity: 1, expiry_date: null },
      { id: 2, quantity: 1, expiry_date: '2027-01-01' },
    ]
    consumptionOrder(lots, TODAY)
    expect(ids(lots)).toEqual([1, 2])
  })
})

describe('lotsForSelection', () => {
  it('returns an empty array for null / undefined / malformed input', () => {
    expect(lotsForSelection(null, TODAY)).toEqual([])
    expect(lotsForSelection(undefined, TODAY)).toEqual([])
    expect(lotsForSelection({}, TODAY)).toEqual([])
    expect(lotsForSelection({ lots: null }, TODAY)).toEqual([])
  })

  it('groups lots sharing lot number and expiry, summing their quantity', () => {
    const stock = {
      lots: [
        { id: 1, quantity: 1, expiry_date: '2028-06-01', lot_number: 'LOT-A', serial_number: 'SN-1' },
        { id: 2, quantity: 2, expiry_date: '2028-06-01', lot_number: 'LOT-A', serial_number: '' },
      ],
    }
    expect(lotsForSelection(stock, TODAY)).toEqual([
      {
        key: 'LOT-A|2028-06-01',
        lot_number: 'LOT-A',
        expiry_date: '2028-06-01',
        quantity: 3,
        rows: [
          { lot_id: 1, quantity: 1 },
          { lot_id: 2, quantity: 2 },
        ],
      },
    ])
  })

  it('keeps lots with the same lot number but different expiry in separate groups', () => {
    const stock = {
      lots: [
        { id: 1, quantity: 1, expiry_date: '2028-06-01', lot_number: 'LOT-A' },
        { id: 2, quantity: 1, expiry_date: '2029-06-01', lot_number: 'LOT-A' },
      ],
    }
    expect(keys(lotsForSelection(stock, TODAY))).toEqual(['LOT-A|2028-06-01', 'LOT-A|2029-06-01'])
  })

  it('normalises an empty lot_number to null', () => {
    const stock = { lots: [{ id: 8, quantity: 1, expiry_date: null, lot_number: '' }] }
    expect(lotsForSelection(stock, TODAY)[0].lot_number).toBeNull()
  })

  it('does not offer an expired group', () => {
    const stock = {
      lots: [
        { id: 1, quantity: 3, expiry_date: '2026-05-01', lot_number: 'OLD' },
        { id: 2, quantity: 3, expiry_date: '2026-06-01', lot_number: 'TODAY' },
        { id: 3, quantity: 3, expiry_date: '2027-01-01', lot_number: 'NEW' },
      ],
    }
    expect(keys(lotsForSelection(stock, TODAY))).toEqual(['NEW|2027-01-01'])
  })

  it('orders groups by expiry, undated last, then by lot number', () => {
    const stock = {
      lots: [
        { id: 1, quantity: 3, expiry_date: null, lot_number: 'Z' },
        { id: 2, quantity: 3, expiry_date: '2027-01-01', lot_number: 'B' },
        { id: 3, quantity: 3, expiry_date: '2027-01-01', lot_number: 'A' },
        { id: 4, quantity: 3, expiry_date: '2026-09-01', lot_number: 'C' },
      ],
    }
    expect(keys(lotsForSelection(stock, TODAY))).toEqual(['C|2026-09-01', 'A|2027-01-01', 'B|2027-01-01', 'Z|'])
  })

  it('orders the rows of a group with the opened box first', () => {
    const stock = {
      lots: [
        { id: 1, quantity: 10, expiry_date: '2027-01-01', lot_number: 'A', created_at: '2026-01-01' },
        { id: 2, quantity: 4, expiry_date: '2027-01-01', lot_number: 'A', created_at: '2026-02-01' },
      ],
    }
    expect(lotsForSelection(stock, TODAY)[0].rows.map((row) => row.lot_id)).toEqual([2, 1])
  })
})

describe('needsLotChoice', () => {
  const groupsOf = (lots) => lotsForSelection({ lots }, TODAY)

  it('asks when there is more than one lot to choose from', () => {
    const groups = groupsOf([
      { id: 1, lot_number: 'A', expiry_date: '2027-01-01', quantity: 1 },
      { id: 2, lot_number: 'B', expiry_date: '2027-01-01', quantity: 1 },
    ])
    expect(needsLotChoice(groups)).toBe(true)
  })

  it('does not ask for two boxes of the same lot', () => {
    const groups = groupsOf([
      { id: 1, lot_number: 'A', expiry_date: '2027-01-01', quantity: 1, serial_number: 'SN-1' },
      { id: 2, lot_number: 'A', expiry_date: '2027-01-01', quantity: 1, serial_number: 'SN-2' },
    ])
    expect(needsLotChoice(groups)).toBe(false)
  })

  it('does not count an expired lot as a choice', () => {
    const groups = groupsOf([
      { id: 1, lot_number: 'OLD', expiry_date: '2026-01-01', quantity: 1 },
      { id: 2, lot_number: 'NEW', expiry_date: '2027-01-01', quantity: 1 },
    ])
    expect(needsLotChoice(groups)).toBe(false)
  })

  it('does not ask when there is nothing at all', () => {
    expect(needsLotChoice([])).toBe(false)
  })
})

describe('allocateFromGroup', () => {
  const [group] = lotsForSelection(
    {
      lots: [
        { id: 1, quantity: 10, expiry_date: '2027-01-01', lot_number: 'A', created_at: '2026-01-01' },
        { id: 2, quantity: 1, expiry_date: '2027-01-01', lot_number: 'A', created_at: '2026-03-01' },
        { id: 3, quantity: 4, expiry_date: '2027-01-01', lot_number: 'A', created_at: '2026-02-01' },
      ],
    },
    TODAY,
  )

  it('returns nothing when no units are needed, or no group is given', () => {
    expect(allocateFromGroup(group, 0)).toEqual([])
    expect(allocateFromGroup(null, 1)).toEqual([])
  })

  it('takes one unit from the most opened box', () => {
    expect(allocateFromGroup(group, 1)).toEqual([{ lot_id: 2, quantity: 1 }])
  })

  it('spreads across the rows in consumption order, never more than a row holds', () => {
    expect(allocateFromGroup(group, 7)).toEqual([
      { lot_id: 2, quantity: 1 },
      { lot_id: 3, quantity: 4 },
      { lot_id: 1, quantity: 2 },
    ])
  })
})

// `groupLots` feeds the stock detail list, which shows every lot — expired
// ones included, so they can be deleted. Its behaviour is not the picker's.
describe('groupLots', () => {
  it('returns an empty array when handed something that is not an array', () => {
    expect(groupLots(null)).toEqual([])
    expect(groupLots(undefined)).toEqual([])
    expect(groupLots({ 0: { quantity: 1 } })).toEqual([])
  })

  it('keeps an expired lot', () => {
    const groups = groupLots([
      { id: 1, lot_number: 'OLD', expiry_date: '2020-01-01', quantity: 2 },
      { id: 2, lot_number: 'NEW', expiry_date: '2099-01-01', quantity: 2 },
    ])
    expect(keys(groups)).toEqual(['OLD|2020-01-01', 'NEW|2099-01-01'])
  })

  it('orders groups by expiry, undated last, ties by the earliest created_at', () => {
    const groups = groupLots([
      { id: 1, lot_number: 'Z', expiry_date: null, quantity: 1, created_at: '2026-01-01' },
      { id: 2, lot_number: 'B', expiry_date: '2027-01-01', quantity: 1, created_at: '2026-01-01' },
      { id: 3, lot_number: 'A', expiry_date: '2027-01-01', quantity: 1, created_at: '2026-02-01' },
    ])
    expect(keys(groups)).toEqual(['B|2027-01-01', 'A|2027-01-01', 'Z|'])
  })

  it('keeps the full lots in rows, ordered by created_at', () => {
    const [group] = groupLots([
      { id: 1, lot_number: 'A', expiry_date: null, quantity: 1, created_at: '2026-02-01', updated_at: 'u1' },
      { id: 2, lot_number: 'A', expiry_date: null, quantity: 9, created_at: '2026-01-01', updated_at: 'u2' },
      { id: 3, lot_number: 'A', expiry_date: null, quantity: 1 },
    ])
    expect(group.rows.map((lot) => lot.id)).toEqual([3, 2, 1])
    expect(group.rows[1].updated_at).toBe('u2')
    expect(group.created_at).toBe('2026-01-01')
  })

  it('counts a lot with no quantity as zero when minQuantity allows it through', () => {
    const groups = groupLots(
      [
        { id: 1, lot_number: 'L', quantity: null },
        { id: 2, lot_number: 'L', quantity: 2 },
      ],
      { minQuantity: 0 },
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].quantity).toBe(2)
    expect(groups[0].rows).toHaveLength(2)
  })

  it('keeps depleted lots at minQuantity 0 and drops them at the default', () => {
    const lots = [{ id: 1, lot_number: 'L', quantity: 0 }]
    expect(groupLots(lots, { minQuantity: 0 })).toHaveLength(1)
    expect(groupLots(lots)).toEqual([])
  })
})

describe('findCachedStock', () => {
  it('returns undefined for null or undefined ids', () => {
    const qc = new QueryClient()
    expect(findCachedStock(qc, null)).toBeUndefined()
    expect(findCachedStock(qc, undefined)).toBeUndefined()
  })

  it('reads from the detail cache first', () => {
    const qc = new QueryClient()
    qc.setQueryData(['stock', 5], { id: 5, name: 'Detail' })
    qc.setQueryData(['stock'], [{ id: 5, name: 'ListVariant' }])
    expect(findCachedStock(qc, 5).name).toBe('Detail')
  })

  it('falls back to the list cache when detail is absent', () => {
    const qc = new QueryClient()
    qc.setQueryData(['stock'], [{ id: 7, name: 'ListOnly' }])
    expect(findCachedStock(qc, 7).name).toBe('ListOnly')
  })

  it('accepts string ids (coerced to number for both caches)', () => {
    const qc = new QueryClient()
    qc.setQueryData(['stock'], [{ id: 9, name: 'Nine' }])
    expect(findCachedStock(qc, '9').name).toBe('Nine')
  })

  it('returns undefined when neither cache has the stock', () => {
    const qc = new QueryClient()
    qc.setQueryData(['stock'], [{ id: 1 }])
    expect(findCachedStock(qc, 42)).toBeUndefined()
  })

  it('returns undefined when the list cache is not an array', () => {
    const qc = new QueryClient()
    qc.setQueryData(['stock'], { not: 'array' })
    expect(findCachedStock(qc, 1)).toBeUndefined()
  })
})

describe('routineLotDecision', () => {
  const routine = (overrides = {}) => ({ id: 1, stock: 10, stock_usage: 1, ...overrides })
  const lotA = { id: 1, lot_number: 'A', expiry_date: '2027-01-01', quantity: 2 }
  const lotB = { id: 2, lot_number: 'B', expiry_date: '2027-06-01', quantity: 1 }
  const expired = { id: 3, lot_number: 'OLD', expiry_date: '2026-01-01', quantity: 4 }

  it('logs when the routine has no stock', () => {
    expect(routineLotDecision(routine({ stock: null }), undefined, TODAY)).toEqual({ action: 'log' })
    expect(routineLotDecision(undefined, undefined, TODAY)).toEqual({ action: 'log' })
  })

  it('logs with one consumable lot', () => {
    expect(routineLotDecision(routine(), { lots: [lotA] }, TODAY)).toEqual({ action: 'log' })
  })

  it('logs when the only other lot has expired', () => {
    expect(routineLotDecision(routine(), { lots: [expired, lotA] }, TODAY)).toEqual({ action: 'log' })
  })

  it('asks with the groups in consumption order when there are two lots', () => {
    const decision = routineLotDecision(routine(), { lots: [lotB, lotA] }, TODAY)
    expect(decision.action).toBe('ask')
    expect(keys(decision.groups)).toEqual(['A|2027-01-01', 'B|2027-06-01'])
  })

  it('reports insufficient stock when every cached lot has expired or is empty', () => {
    const empty = { ...lotA, quantity: 0 }
    expect(routineLotDecision(routine(), { lots: [expired, empty] }, TODAY)).toEqual({ action: 'insufficient' })
  })

  it("falls back to the server's requires_lot_selection when the stock is not cached", () => {
    expect(routineLotDecision(routine({ requires_lot_selection: false }), undefined, TODAY)).toEqual({ action: 'log' })
    expect(routineLotDecision(routine({ requires_lot_selection: true }), undefined, TODAY)).toEqual({
      action: 'unavailable',
    })
  })

  it('treats a cached stock without a lot list as not cached', () => {
    expect(routineLotDecision(routine({ requires_lot_selection: true }), { id: 10 }, TODAY)).toEqual({
      action: 'unavailable',
    })
  })
})
