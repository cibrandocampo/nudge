/**
 * Build the lot-number suggestions the add-lot form offers, each carrying the
 * expiry date it would fill in.
 *
 * The form used to suggest a bare set of strings. Once picking a suggestion is
 * meant to inherit the batch's expiry, that list is wrong twice over: it
 * carries no date, and it offers batches whose expiry has already passed —
 * dates the backend refuses (`StockLotSerializer.validate_expiry_date`), so
 * autofilling one would hand the user a value that cannot be saved.
 *
 * The rules, in the order they apply:
 *
 *   1. only lots that actually carry a batch number;
 *   2. lots whose expiry is before `today` are dropped — one expiring *today*
 *      is still valid and stays;
 *   3. lots with no expiry stay, as `expiry_date: null`; there is simply
 *      nothing to inherit from them;
 *   4. one entry per batch number: a number appearing under two dates resolves
 *      to the earliest, and a real date beats no date at all;
 *   5. ordered by expiry ascending, nulls last, ties broken by number.
 *
 * @param stock a cached Stock object; anything malformed yields `[]`
 * @param today local-midnight Date, passed in rather than read from the clock
 *   so a caller and its tests never disagree about when "now" is. Same
 *   convention as `lotExpirySeverity`.
 * @returns {Array<{ lot_number: string, expiry_date: string | null }>}
 */
export function lotSuggestions(stock, today) {
  if (!stock || !Array.isArray(stock.lots)) return []

  // Keyed by batch number, so the same number cannot appear twice however many
  // rows carry it.
  const earliest = new Map()

  for (const lot of stock.lots) {
    const number = (lot.lot_number ?? '').trim()
    if (!number) continue

    const expiry = lot.expiry_date ?? null
    if (expiry !== null && new Date(expiry) < today) continue

    if (!earliest.has(number)) {
      earliest.set(number, expiry)
      continue
    }
    const kept = earliest.get(number)
    // A date is worth more than none, and the earliest date wins. Two dates for
    // one batch number is a data anomaly the model allows (lots group by number
    // *and* expiry) rather than a supported state — this keeps the list
    // deterministic, it does not bless the input.
    if (kept === null || (expiry !== null && expiry < kept)) {
      earliest.set(number, expiry)
    }
  }

  return [...earliest].map(([lot_number, expiry_date]) => ({ lot_number, expiry_date })).sort(bySoonestExpiry)
}

// Soonest first, undated last, ties broken by the number so the order never
// depends on how the rows happened to arrive. Mirrors `fefoCompare` in
// `lotsForSelection.js`, including its sentinel.
function bySoonestExpiry(a, b) {
  const aDate = a.expiry_date ?? '9999-12-31'
  const bDate = b.expiry_date ?? '9999-12-31'
  if (aDate !== bDate) return aDate.localeCompare(bDate)
  return a.lot_number.localeCompare(b.lot_number)
}
