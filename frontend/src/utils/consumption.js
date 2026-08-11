const MONTHLY_FACTOR = 30

/**
 * A daily consumption rate as the monthly figure the UI shows.
 *
 * Whole months stay whole (`2` not `2.0`); anything else gets one decimal.
 * Extracted in T091 from the card `StockRow` replaced, so the two could not
 * drift apart on how a rate reads while both existed.
 */
export function toMonthly(dailyRate) {
  const monthly = dailyRate * MONTHLY_FACTOR
  return monthly % 1 === 0 ? String(monthly) : monthly.toFixed(1)
}
