import { describe, expect, it } from 'vitest'
import { lotSuggestions } from '../lotSuggestions'

// Local midnight, the same shape the pages build and hand down.
const TODAY = new Date('2026-06-01')

const lot = (overrides) => ({ id: 1, quantity: 1, lot_number: 'LOT-A', expiry_date: null, ...overrides })
const numbers = (result) => result.map((s) => s.lot_number)

describe('lotSuggestions', () => {
  it('returns an empty array for null / undefined / malformed input', () => {
    expect(lotSuggestions(null, TODAY)).toEqual([])
    expect(lotSuggestions(undefined, TODAY)).toEqual([])
    expect(lotSuggestions({}, TODAY)).toEqual([])
    expect(lotSuggestions({ lots: null }, TODAY)).toEqual([])
  })

  it('does not suggest a lot with no batch number', () => {
    const stock = { lots: [lot({ lot_number: null }), lot({ lot_number: 'REAL' })] }
    expect(numbers(lotSuggestions(stock, TODAY))).toEqual(['REAL'])
  })

  it('does not suggest a batch number that is only whitespace', () => {
    const stock = { lots: [lot({ lot_number: '   ' }), lot({ lot_number: 'REAL' })] }
    expect(numbers(lotSuggestions(stock, TODAY))).toEqual(['REAL'])
  })

  // The backend refuses a past expiry, so suggesting one would autofill a value
  // that cannot be saved.
  it('drops a batch whose expiry has already passed', () => {
    const stock = { lots: [lot({ lot_number: 'OLD', expiry_date: '2026-05-31' })] }
    expect(lotSuggestions(stock, TODAY)).toEqual([])
  })

  it('keeps a batch expiring today — it is still valid', () => {
    const stock = { lots: [lot({ lot_number: 'TODAY', expiry_date: '2026-06-01' })] }
    expect(lotSuggestions(stock, TODAY)).toEqual([{ lot_number: 'TODAY', expiry_date: '2026-06-01' }])
  })

  it('keeps a batch with no expiry, carrying null', () => {
    const stock = { lots: [lot({ lot_number: 'NODATE', expiry_date: null })] }
    expect(lotSuggestions(stock, TODAY)).toEqual([{ lot_number: 'NODATE', expiry_date: null }])
  })

  // A data anomaly the model allows — lots group by number *and* expiry — so
  // the list has to stay deterministic rather than showing the number twice.
  it('resolves one batch number under two dates to the earlier one', () => {
    const stock = {
      lots: [
        lot({ id: 1, lot_number: 'DUP', expiry_date: '2027-01-01' }),
        lot({ id: 2, lot_number: 'DUP', expiry_date: '2026-09-01' }),
      ],
    }
    expect(lotSuggestions(stock, TODAY)).toEqual([{ lot_number: 'DUP', expiry_date: '2026-09-01' }])
  })

  it('lets a real date win over the same number with none', () => {
    const stock = {
      lots: [
        lot({ id: 1, lot_number: 'MIX', expiry_date: null }),
        lot({ id: 2, lot_number: 'MIX', expiry_date: '2027-03-01' }),
      ],
    }
    expect(lotSuggestions(stock, TODAY)).toEqual([{ lot_number: 'MIX', expiry_date: '2027-03-01' }])
  })

  // Both tiebreaks above are stated as rules, not as "whatever the first row
  // said", so they have to hold whichever order the rows arrive in. These two
  // are the same cases read backwards.
  it('keeps the earlier date when the later one arrives second', () => {
    const stock = {
      lots: [
        lot({ id: 1, lot_number: 'DUP', expiry_date: '2026-09-01' }),
        lot({ id: 2, lot_number: 'DUP', expiry_date: '2027-01-01' }),
      ],
    }
    expect(lotSuggestions(stock, TODAY)).toEqual([{ lot_number: 'DUP', expiry_date: '2026-09-01' }])
  })

  it('keeps the date when the same number arrives again with none', () => {
    const stock = {
      lots: [
        lot({ id: 1, lot_number: 'MIX', expiry_date: '2027-03-01' }),
        lot({ id: 2, lot_number: 'MIX', expiry_date: null }),
      ],
    }
    expect(lotSuggestions(stock, TODAY)).toEqual([{ lot_number: 'MIX', expiry_date: '2027-03-01' }])
  })

  it('orders by soonest expiry, with undated batches last', () => {
    const stock = {
      lots: [
        lot({ id: 1, lot_number: 'LATE', expiry_date: '2028-01-01' }),
        lot({ id: 2, lot_number: 'NONE', expiry_date: null }),
        lot({ id: 3, lot_number: 'SOON', expiry_date: '2026-07-01' }),
      ],
    }
    expect(numbers(lotSuggestions(stock, TODAY))).toEqual(['SOON', 'LATE', 'NONE'])
  })

  it('breaks a shared expiry by batch number, so row order never decides', () => {
    const stock = {
      lots: [
        lot({ id: 1, lot_number: 'B', expiry_date: '2027-05-05' }),
        lot({ id: 2, lot_number: 'A', expiry_date: '2027-05-05' }),
      ],
    }
    expect(numbers(lotSuggestions(stock, TODAY))).toEqual(['A', 'B'])
  })
})
