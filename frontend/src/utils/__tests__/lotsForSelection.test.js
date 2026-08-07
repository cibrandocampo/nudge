import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { allocateFromGroup, bulkQuantity, findCachedStock, groupLots, lotsForSelection } from '../lotsForSelection'

const ids = (groups) => groups.map((g) => g.key)

describe('lotsForSelection', () => {
  it('returns an empty array for null / undefined / malformed input', () => {
    expect(lotsForSelection(null)).toEqual([])
    expect(lotsForSelection(undefined)).toEqual([])
    expect(lotsForSelection({})).toEqual([])
    expect(lotsForSelection({ lots: null })).toEqual([])
  })

  it('filters out lots with quantity 0', () => {
    const stock = {
      lots: [
        { id: 1, quantity: 0, expiry_date: '2026-05-01', lot_number: 'A' },
        { id: 2, quantity: 5, expiry_date: '2026-06-01', lot_number: 'B' },
      ],
    }
    const result = lotsForSelection(stock)
    expect(result).toHaveLength(1)
    expect(result[0].bulk).toEqual([{ lot_id: 2, quantity: 5, created_at: '' }])
  })

  it('treats lots with undefined quantity as zero (filtered out)', () => {
    const stock = {
      lots: [
        { id: 1, expiry_date: '2026-01-01', lot_number: 'A' }, // quantity undefined
        { id: 2, quantity: 2, expiry_date: '2026-02-01', lot_number: 'B' },
      ],
    }
    expect(ids(lotsForSelection(stock))).toEqual(['B|2026-02-01'])
  })

  it('orders groups by expiry_date ascending (FEFO)', () => {
    const stock = {
      lots: [
        { id: 1, quantity: 3, expiry_date: '2026-06-01', lot_number: 'B' },
        { id: 2, quantity: 3, expiry_date: '2026-05-01', lot_number: 'A' },
      ],
    }
    expect(ids(lotsForSelection(stock))).toEqual(['A|2026-05-01', 'B|2026-06-01'])
  })

  it('places groups with null expiry at the end', () => {
    const stock = {
      lots: [
        { id: 1, quantity: 3, expiry_date: null, lot_number: 'Z' },
        { id: 2, quantity: 3, expiry_date: '2026-05-01', lot_number: 'A' },
        { id: 3, quantity: 3, expiry_date: '2026-06-01', lot_number: 'B' },
      ],
    }
    expect(ids(lotsForSelection(stock))).toEqual(['A|2026-05-01', 'B|2026-06-01', 'Z|'])
  })

  it('uses the earliest created_at to break ties on expiry_date', () => {
    const stock = {
      lots: [
        { id: 1, quantity: 3, expiry_date: '2026-06-01', lot_number: 'B', created_at: '2026-01-02T00:00:00Z' },
        { id: 2, quantity: 3, expiry_date: '2026-06-01', lot_number: 'A', created_at: '2026-01-01T00:00:00Z' },
      ],
    }
    expect(ids(lotsForSelection(stock))).toEqual(['A|2026-06-01', 'B|2026-06-01'])
  })

  it('handles undefined created_at when breaking a tie', () => {
    const stock = {
      lots: [
        { id: 1, quantity: 1, expiry_date: '2026-05-01', lot_number: 'A' }, // no created_at
        { id: 2, quantity: 1, expiry_date: '2026-05-01', lot_number: 'B', created_at: '2026-01-01T00:00:00Z' },
      ],
    }
    // Empty string sorts before a real timestamp.
    expect(ids(lotsForSelection(stock))).toEqual(['A|2026-05-01', 'B|2026-05-01'])
  })

  it('normalises an empty lot_number to null', () => {
    const stock = { lots: [{ id: 8, quantity: 1, expiry_date: null, lot_number: '' }] }
    expect(lotsForSelection(stock)[0].lot_number).toBeNull()
  })

  it('groups lots sharing lot number and expiry, summing their quantity', () => {
    const stock = {
      lots: [
        { id: 1, quantity: 1, expiry_date: '2028-06-01', lot_number: 'LOT-A', serial_number: 'SN-1' },
        { id: 2, quantity: 1, expiry_date: '2028-06-01', lot_number: 'LOT-A', serial_number: 'SN-2' },
      ],
    }
    const result = lotsForSelection(stock)
    expect(result).toHaveLength(1)
    expect(result[0].quantity).toBe(2)
    expect(result[0].packs.map((p) => p.serial_number)).toEqual(['SN-1', 'SN-2'])
  })

  it('keeps lots with the same lot number but different expiry in separate groups', () => {
    const stock = {
      lots: [
        { id: 1, quantity: 1, expiry_date: '2028-06-01', lot_number: 'LOT-A' },
        { id: 2, quantity: 1, expiry_date: '2029-06-01', lot_number: 'LOT-A' },
      ],
    }
    expect(lotsForSelection(stock)).toHaveLength(2)
  })

  it('splits a group into serialized packs and unserialized bulk', () => {
    const stock = {
      lots: [
        { id: 1, quantity: 1, expiry_date: '2028-06-01', lot_number: 'LOT-A', serial_number: 'SN-1' },
        { id: 2, quantity: 5, expiry_date: '2028-06-01', lot_number: 'LOT-A', serial_number: '' },
      ],
    }
    const [group] = lotsForSelection(stock)
    expect(group.packs).toHaveLength(1)
    expect(group.bulk).toHaveLength(1)
    expect(group.quantity).toBe(6)
    expect(bulkQuantity(group)).toBe(5)
  })

  it('orders packs within a group by created_at', () => {
    const stock = {
      lots: [
        {
          id: 1,
          quantity: 1,
          expiry_date: '2028-06-01',
          lot_number: 'A',
          serial_number: 'SN-LATE',
          created_at: '2026-02-01T00:00:00Z',
        },
        {
          id: 2,
          quantity: 1,
          expiry_date: '2028-06-01',
          lot_number: 'A',
          serial_number: 'SN-EARLY',
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    }
    const [group] = lotsForSelection(stock)
    expect(group.packs.map((p) => p.serial_number)).toEqual(['SN-EARLY', 'SN-LATE'])
  })
})

// `groupLots` is also called directly by the stock detail page, with
// `minQuantity: 0` so a depleted lot is still listed for deletion. That entry
// point reaches inputs `lotsForSelection` filters out first.
describe('groupLots', () => {
  it('returns an empty array when handed something that is not an array', () => {
    expect(groupLots(null)).toEqual([])
    expect(groupLots(undefined)).toEqual([])
    expect(groupLots({ 0: { quantity: 1 } })).toEqual([])
  })

  it('counts a lot with no quantity as zero when minQuantity allows it through', () => {
    const groups = groupLots(
      [
        { id: 1, lot_number: 'L', quantity: null },
        { id: 2, lot_number: 'L', quantity: 2 },
      ],
      {
        minQuantity: 0,
      },
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

describe('allocateFromGroup', () => {
  const group = {
    key: 'LOT-A|2028-06-01',
    lot_number: 'LOT-A',
    expiry_date: '2028-06-01',
    quantity: 7,
    created_at: '',
    packs: [
      { lot_id: 1, serial_number: 'SN-1', quantity: 1, created_at: '' },
      { lot_id: 2, serial_number: 'SN-2', quantity: 1, created_at: '' },
    ],
    bulk: [{ lot_id: 3, quantity: 5, created_at: '' }],
  }

  it('returns nothing when no units are needed', () => {
    expect(allocateFromGroup(group, 0)).toEqual([])
    expect(allocateFromGroup(null, 2)).toEqual([])
  })

  it('allocates one chosen pack as a single unit', () => {
    expect(allocateFromGroup(group, 1, [2])).toEqual([{ lot_id: 2, quantity: 1 }])
  })

  it('allocates several chosen packs', () => {
    expect(allocateFromGroup(group, 2, [1, 2])).toEqual([
      { lot_id: 1, quantity: 1 },
      { lot_id: 2, quantity: 1 },
    ])
  })

  it('ignores packs that were not chosen', () => {
    expect(allocateFromGroup(group, 1, [2])).not.toContainEqual({ lot_id: 1, quantity: 1 })
  })

  it('falls back to bulk rows when no pack is chosen', () => {
    expect(allocateFromGroup(group, 3)).toEqual([{ lot_id: 3, quantity: 3 }])
  })

  it('covers the shortfall from bulk after the chosen packs', () => {
    expect(allocateFromGroup(group, 3, [1])).toEqual([
      { lot_id: 1, quantity: 1 },
      { lot_id: 3, quantity: 2 },
    ])
  })

  it('never allocates more than a row holds', () => {
    const selections = allocateFromGroup(group, 99, [1, 2])
    expect(selections).toEqual([
      { lot_id: 1, quantity: 1 },
      { lot_id: 2, quantity: 1 },
      { lot_id: 3, quantity: 5 },
    ])
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
