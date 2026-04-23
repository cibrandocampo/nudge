import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { findCachedStock, lotsForSelection } from '../lotsForSelection'

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
    expect(result[0].lot_id).toBe(2)
  })

  it('orders by expiry_date ascending (FEFO)', () => {
    const stock = {
      lots: [
        { id: 1, quantity: 3, expiry_date: '2026-06-01', lot_number: 'B' },
        { id: 2, quantity: 3, expiry_date: '2026-05-01', lot_number: 'A' },
      ],
    }
    const result = lotsForSelection(stock)
    expect(result.map((l) => l.lot_id)).toEqual([2, 1])
  })

  it('places lots with null expiry at the end', () => {
    const stock = {
      lots: [
        { id: 1, quantity: 3, expiry_date: null, lot_number: 'Z' },
        { id: 2, quantity: 3, expiry_date: '2026-05-01', lot_number: 'A' },
        { id: 3, quantity: 3, expiry_date: '2026-06-01', lot_number: 'B' },
      ],
    }
    const result = lotsForSelection(stock)
    expect(result.map((l) => l.lot_id)).toEqual([2, 3, 1])
  })

  it('uses created_at to break ties on expiry_date', () => {
    const stock = {
      lots: [
        { id: 1, quantity: 3, expiry_date: '2026-06-01', created_at: '2026-01-02T00:00:00Z' },
        { id: 2, quantity: 3, expiry_date: '2026-06-01', created_at: '2026-01-01T00:00:00Z' },
      ],
    }
    const result = lotsForSelection(stock)
    expect(result.map((l) => l.lot_id)).toEqual([2, 1])
  })

  it('maps to the backend selection shape', () => {
    const stock = {
      lots: [{ id: 7, quantity: 10, expiry_date: '2026-07-01', lot_number: 'LOT-7' }],
    }
    expect(lotsForSelection(stock)).toEqual([
      { lot_id: 7, lot_number: 'LOT-7', expiry_date: '2026-07-01', quantity: 10 },
    ])
  })

  it('normalises missing lot_number to null', () => {
    const stock = { lots: [{ id: 8, quantity: 1, expiry_date: null, lot_number: '' }] }
    expect(lotsForSelection(stock)[0].lot_number).toBeNull()
  })

  it('treats lots with undefined quantity as zero (filtered out)', () => {
    const stock = {
      lots: [
        { id: 1, expiry_date: '2026-01-01', lot_number: 'A' }, // quantity undefined
        { id: 2, quantity: 2, expiry_date: '2026-02-01', lot_number: 'B' },
      ],
    }
    const result = lotsForSelection(stock)
    expect(result.map((l) => l.lot_id)).toEqual([2])
  })

  it('handles undefined created_at when breaking a tie on expiry_date', () => {
    const stock = {
      lots: [
        { id: 1, quantity: 1, expiry_date: '2026-05-01' }, // no created_at
        { id: 2, quantity: 1, expiry_date: '2026-05-01', created_at: '2026-01-01T00:00:00Z' },
      ],
    }
    const result = lotsForSelection(stock)
    // Empty string sorts before a real timestamp.
    expect(result.map((l) => l.lot_id)).toEqual([1, 2])
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
