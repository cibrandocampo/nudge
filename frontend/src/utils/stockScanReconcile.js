/**
 * Decide what a saved lot teaches the product it belongs to.
 *
 * A GS1 DataMatrix does not say how many units a box holds — three real packs
 * of 1, 5 and 10 units carry symbols that differ only in the GTIN. So the app
 * learns the quantity from the user and keeps it on the `Stock`, next to the
 * product code read from the symbol.
 *
 * The rule is applied **field by field**, never as a block:
 *
 *   stored is blank  → assign it, no prompt (filling a hole is not a conflict)
 *   values equal     → nothing at all
 *   values differ    → ask the user
 *
 * The two fields differ in reach. `default_lot_quantity` reconciles on every
 * lot save, scanned or hand-typed, because the quantity in the form is exactly
 * what the field means: what to prefill next time. `gtin` is read from the
 * symbol, so a hand-typed lot has nothing to say about it and must leave the
 * stored code alone.
 *
 * Pure and synchronous: no React, no I/O, no side effects. The caller decides
 * what to do with the answer — this only reports.
 */

/** Stored values count as blank when they have never been set. */
function isBlank(value) {
  return value === '' || value === null || value === undefined
}

/**
 * A quantity is only evidence when it is a positive integer. The form validates
 * this already; the guard is here so a stray `''`, `NaN` or `0` from an
 * unexpected caller cannot be written to the product as a default.
 */
function isUsableQuantity(value) {
  return Number.isInteger(value) && value > 0
}

/**
 * @param {object} args
 * @param {object|null|undefined} args.stock - the stock as cached (`gtin`, `default_lot_quantity`).
 * @param {object|null} args.scan - the `parseGs1` result, or null for a hand-typed lot.
 * @param {number} args.quantity - the quantity being submitted.
 * @returns {{ silent: object, discrepant: Array<{field: string, current: *, next: *}> }}
 *   `silent` holds values to write without asking; `discrepant` holds one entry
 *   per field where stored and new disagree. Both keys are always present, so
 *   callers never have to guard for undefined.
 */
export function reconcileStockFromLot({ stock, scan, quantity }) {
  const silent = {}
  const discrepant = []

  // Compared as strings on purpose: a GTIN's leading zero is significant
  // (`05705244020856`), so any numeric coercion would corrupt the value and
  // make two different products look identical.
  const scannedGtin = scan?.gtin
  if (!isBlank(scannedGtin)) {
    const current = stock?.gtin
    if (isBlank(current)) silent.gtin = scannedGtin
    else if (current !== scannedGtin) discrepant.push({ field: 'gtin', current, next: scannedGtin })
  }

  if (isUsableQuantity(quantity)) {
    const current = stock?.default_lot_quantity
    // Note `0` is deliberately *not* blank here: the backend rejects it, but a
    // cached payload carrying one must not be silently reinterpreted as unset.
    if (current === null || current === undefined) silent.default_lot_quantity = quantity
    else if (current !== quantity) discrepant.push({ field: 'default_lot_quantity', current, next: quantity })
  }

  return { silent, discrepant }
}
