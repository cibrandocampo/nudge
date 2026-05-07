import { QueryClient } from '@tanstack/react-query'
import { findRoutineInCaches, findStockInCaches, routineSeedUpdatedAt, stockSeedUpdatedAt } from '../queryCacheLookup'

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('findRoutineInCaches', () => {
  it("returns the routine when it lives in the dashboard's `due` bucket", () => {
    const qc = makeClient()
    const routine = { id: 7, name: 'Take vitamins', interval_hours: 24 }
    qc.setQueryData(['dashboard'], { due: [routine], upcoming: [] })
    expect(findRoutineInCaches(qc, 7)).toBe(routine)
  })

  it("returns the routine when it lives in the dashboard's `upcoming` bucket", () => {
    const qc = makeClient()
    const routine = { id: 9, name: 'Water plant' }
    qc.setQueryData(['dashboard'], { due: [], upcoming: [routine] })
    expect(findRoutineInCaches(qc, 9)).toBe(routine)
  })

  it("falls back to the ['routines'] cache when dashboard does not have the id", () => {
    const qc = makeClient()
    const fromList = { id: 11, name: 'From list' }
    qc.setQueryData(['dashboard'], { due: [{ id: 99 }], upcoming: [] })
    qc.setQueryData(['routines'], [fromList])
    expect(findRoutineInCaches(qc, 11)).toBe(fromList)
  })

  it('returns undefined when neither cache contains the id', () => {
    const qc = makeClient()
    qc.setQueryData(['dashboard'], { due: [{ id: 1 }], upcoming: [{ id: 2 }] })
    qc.setQueryData(['routines'], [{ id: 3 }])
    expect(findRoutineInCaches(qc, 99)).toBeUndefined()
  })

  it('returns undefined for null / undefined / NaN ids', () => {
    const qc = makeClient()
    qc.setQueryData(['dashboard'], { due: [{ id: 7 }], upcoming: [] })
    expect(findRoutineInCaches(qc, null)).toBeUndefined()
    expect(findRoutineInCaches(qc, undefined)).toBeUndefined()
    expect(findRoutineInCaches(qc, 'not-a-number')).toBeUndefined()
  })

  it('coerces string ids that round-trip cleanly to numbers', () => {
    // useRoutine receives id from URL params (a string). The lookup must
    // match the cached numeric id without forcing the caller to coerce.
    const qc = makeClient()
    const routine = { id: 42, name: 'Coerced' }
    qc.setQueryData(['dashboard'], { due: [routine], upcoming: [] })
    expect(findRoutineInCaches(qc, '42')).toBe(routine)
  })

  it('returns undefined when both caches are empty', () => {
    const qc = makeClient()
    expect(findRoutineInCaches(qc, 1)).toBeUndefined()
  })

  it('handles a dashboard payload missing due / upcoming buckets', () => {
    // The fallback `?? []` branch on each bucket fires when the dashboard
    // serialiser returns a partial shape (e.g. an old persisted snapshot
    // pre-T112 that only had ``due`` populated).
    const qc = makeClient()
    qc.setQueryData(['dashboard'], { upcoming: [{ id: 5, name: 'Only in upcoming' }] })
    expect(findRoutineInCaches(qc, 5)).toEqual({ id: 5, name: 'Only in upcoming' })
    qc.setQueryData(['dashboard'], { due: [{ id: 6, name: 'Only in due' }] })
    expect(findRoutineInCaches(qc, 6)).toEqual({ id: 6, name: 'Only in due' })
  })
})

describe('routineSeedUpdatedAt', () => {
  it('returns the max of dashboard and routines dataUpdatedAt', () => {
    const qc = makeClient()
    qc.setQueryData(['dashboard'], { due: [], upcoming: [] })
    qc.setQueryData(['routines'], [])
    const dash = qc.getQueryState(['dashboard']).dataUpdatedAt
    const list = qc.getQueryState(['routines']).dataUpdatedAt
    expect(routineSeedUpdatedAt(qc)).toBe(Math.max(dash, list))
  })

  it('returns 0 when no relevant cache exists', () => {
    const qc = makeClient()
    expect(routineSeedUpdatedAt(qc)).toBe(0)
  })
})

describe('findStockInCaches', () => {
  it("returns the stock when it lives in the ['stock'] list", () => {
    const qc = makeClient()
    const stock = { id: 5, name: 'Filters' }
    qc.setQueryData(['stock'], [stock, { id: 6 }])
    expect(findStockInCaches(qc, 5)).toBe(stock)
  })

  it('returns undefined when the id is unknown to the list', () => {
    const qc = makeClient()
    qc.setQueryData(['stock'], [{ id: 1 }, { id: 2 }])
    expect(findStockInCaches(qc, 99)).toBeUndefined()
  })

  it('returns undefined for null / undefined / NaN ids', () => {
    const qc = makeClient()
    qc.setQueryData(['stock'], [{ id: 1 }])
    expect(findStockInCaches(qc, null)).toBeUndefined()
    expect(findStockInCaches(qc, undefined)).toBeUndefined()
    expect(findStockInCaches(qc, 'foo')).toBeUndefined()
  })

  it('coerces string ids', () => {
    const qc = makeClient()
    const stock = { id: 12, name: 'Coerced stock' }
    qc.setQueryData(['stock'], [stock])
    expect(findStockInCaches(qc, '12')).toBe(stock)
  })

  it('returns undefined when the cache is empty', () => {
    const qc = makeClient()
    expect(findStockInCaches(qc, 1)).toBeUndefined()
  })
})

describe('stockSeedUpdatedAt', () => {
  it("returns the ['stock'] dataUpdatedAt", () => {
    const qc = makeClient()
    qc.setQueryData(['stock'], [])
    expect(stockSeedUpdatedAt(qc)).toBe(qc.getQueryState(['stock']).dataUpdatedAt)
  })

  it('returns 0 when no stock cache exists', () => {
    const qc = makeClient()
    expect(stockSeedUpdatedAt(qc)).toBe(0)
  })
})
