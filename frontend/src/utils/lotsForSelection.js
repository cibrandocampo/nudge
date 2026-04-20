/**
 * Build the lot-selection list from a cached Stock object.
 *
 * Mirrors the backend's `lots-for-selection` endpoint
 * (apps/routines/views.py) — FEFO ordering: expiry_date ascending, nulls
 * last, ties broken by created_at. Only lots with `quantity > 0` are
 * included.
 *
 * The frontend derives this list from the cached stock so the lot
 * selection modal works offline: no extra HTTP call, and the stock's own
 * cache (seeded by `useStockList()` or `useStock(id)`) is the single
 * source of truth. Use `findCachedStock(queryClient, id)` to fetch the
 * stock from whichever cache has it.
 */
export function lotsForSelection(stock) {
  if (!stock || !Array.isArray(stock.lots)) return []
  return stock.lots
    .filter((lot) => (lot.quantity ?? 0) > 0)
    .slice()
    .sort(fefoCompare)
    .map((lot) => ({
      lot_id: lot.id,
      lot_number: lot.lot_number || null,
      expiry_date: lot.expiry_date ?? null,
      quantity: lot.quantity,
    }))
}

function fefoCompare(a, b) {
  const aDate = a.expiry_date ?? '9999-12-31'
  const bDate = b.expiry_date ?? '9999-12-31'
  if (aDate !== bDate) return aDate.localeCompare(bDate)
  return (a.created_at ?? '').localeCompare(b.created_at ?? '')
}

/**
 * Locate a cached stock by id, looking first at the per-stock detail cache
 * (`['stock', id]`) and falling back to the list cache (`['stock']`).
 * Returns `undefined` if neither knows about it.
 */
export function findCachedStock(queryClient, stockId) {
  if (stockId === null || stockId === undefined) return undefined
  const id = Number(stockId)
  const detail = queryClient.getQueryData(['stock', id])
  if (detail) return detail
  const list = queryClient.getQueryData(['stock'])
  if (Array.isArray(list)) return list.find((s) => s.id === id)
  return undefined
}
