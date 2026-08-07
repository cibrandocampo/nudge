import { describe, expect, it } from 'vitest'
import { reconcileStockFromLot } from '../stockScanReconcile'

// Real GTIN-14 from a scanned pack. The leading zero is significant, which is
// why the helper compares as a string and never as a number.
const GTIN = '05705244020856'
const OTHER_GTIN = '08470007285144'

const scanWith = (gtin) => ({ gtin, lotNumber: 'VS6RE45', expiryDate: '2028-05-31', serialNumber: null })

describe('reconcileStockFromLot', () => {
  it('assigns both values when the product knows nothing yet', () => {
    const result = reconcileStockFromLot({
      stock: { gtin: '', default_lot_quantity: null },
      scan: scanWith(GTIN),
      quantity: 5,
    })

    expect(result.silent).toEqual({ gtin: GTIN, default_lot_quantity: 5 })
    expect(result.discrepant).toEqual([])
  })

  it('does nothing when both values already match', () => {
    const result = reconcileStockFromLot({
      stock: { gtin: GTIN, default_lot_quantity: 5 },
      scan: scanWith(GTIN),
      quantity: 5,
    })

    expect(result.silent).toEqual({})
    expect(result.discrepant).toEqual([])
  })

  it('reports a different GTIN instead of overwriting it', () => {
    const result = reconcileStockFromLot({
      stock: { gtin: GTIN, default_lot_quantity: 5 },
      scan: scanWith(OTHER_GTIN),
      quantity: 5,
    })

    expect(result.silent).toEqual({})
    expect(result.discrepant).toEqual([{ field: 'gtin', current: GTIN, next: OTHER_GTIN }])
  })

  it('reports a different quantity instead of overwriting it', () => {
    const result = reconcileStockFromLot({
      stock: { gtin: GTIN, default_lot_quantity: 10 },
      scan: scanWith(GTIN),
      quantity: 6,
    })

    expect(result.silent).toEqual({})
    expect(result.discrepant).toEqual([{ field: 'default_lot_quantity', current: 10, next: 6 }])
  })

  it('reports both fields when both disagree', () => {
    const result = reconcileStockFromLot({
      stock: { gtin: GTIN, default_lot_quantity: 10 },
      scan: scanWith(OTHER_GTIN),
      quantity: 6,
    })

    expect(result.silent).toEqual({})
    expect(result.discrepant).toEqual([
      { field: 'gtin', current: GTIN, next: OTHER_GTIN },
      { field: 'default_lot_quantity', current: 10, next: 6 },
    ])
  })

  it('treats the two fields independently rather than as a block', () => {
    // The failure this guards against: implementing "any mismatch → prompt for
    // everything", which would ask about a quantity that was simply unset.
    const result = reconcileStockFromLot({
      stock: { gtin: GTIN, default_lot_quantity: null },
      scan: scanWith(GTIN),
      quantity: 5,
    })

    expect(result.silent).toEqual({ default_lot_quantity: 5 })
    expect(result.discrepant).toEqual([])
  })

  it('leaves the stored GTIN alone for a hand-typed lot, but still reconciles the quantity', () => {
    const result = reconcileStockFromLot({
      stock: { gtin: GTIN, default_lot_quantity: 10 },
      scan: null,
      quantity: 6,
    })

    expect(result.silent).toEqual({})
    expect(result.discrepant).toEqual([{ field: 'default_lot_quantity', current: 10, next: 6 }])
  })

  it('ignores a scan that carries no GTIN', () => {
    const result = reconcileStockFromLot({
      stock: { gtin: '', default_lot_quantity: 5 },
      scan: scanWith(null),
      quantity: 5,
    })

    expect(result.silent).toEqual({})
    expect(result.discrepant).toEqual([])
  })

  it('treats a stored quantity of 0 as a value, not as unset', () => {
    // The backend rejects 0, but a cached payload carrying one must not be
    // silently reinterpreted — that would overwrite it with no prompt.
    const result = reconcileStockFromLot({
      stock: { gtin: GTIN, default_lot_quantity: 0 },
      scan: scanWith(GTIN),
      quantity: 5,
    })

    expect(result.silent).toEqual({})
    expect(result.discrepant).toEqual([{ field: 'default_lot_quantity', current: 0, next: 5 }])
  })

  it('compares GTINs as strings, so a leading zero is never lost', () => {
    const same = reconcileStockFromLot({
      stock: { gtin: GTIN, default_lot_quantity: 5 },
      scan: scanWith(GTIN),
      quantity: 5,
    })
    expect(same.discrepant).toEqual([])

    // Numerically equal, textually different: a real product code mismatch.
    const numericLookalike = reconcileStockFromLot({
      stock: { gtin: '5705244020856', default_lot_quantity: 5 },
      scan: scanWith(GTIN),
      quantity: 5,
    })
    expect(numericLookalike.discrepant).toEqual([{ field: 'gtin', current: '5705244020856', next: GTIN }])
  })

  it.each([
    ['zero', 0],
    ['negative', -3],
    ['NaN', NaN],
    ['a numeric string', '5'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a fraction', 2.5],
  ])('skips the quantity when it is %s', (_label, quantity) => {
    const result = reconcileStockFromLot({
      stock: { gtin: GTIN, default_lot_quantity: 10 },
      scan: scanWith(GTIN),
      quantity,
    })

    expect(result.silent).toEqual({})
    expect(result.discrepant).toEqual([])
  })

  it('survives a missing stock and a missing scan', () => {
    // Defensive: the cache can be cold on the very first render.
    expect(reconcileStockFromLot({ stock: null, scan: null, quantity: 5 })).toEqual({
      silent: { default_lot_quantity: 5 },
      discrepant: [],
    })
    expect(reconcileStockFromLot({ stock: undefined, scan: undefined, quantity: 5 })).toEqual({
      silent: { default_lot_quantity: 5 },
      discrepant: [],
    })
  })
})
