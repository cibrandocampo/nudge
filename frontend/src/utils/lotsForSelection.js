/**
 * Build the lot-selection list from a cached Stock object.
 *
 * Lots are **grouped** by `(lot_number, expiry_date)`: scanning three boxes of
 * the same batch creates three `StockLot` rows, which would otherwise show up
 * as three visually identical entries. Within a group the rows are split in
 * two, because they are different things:
 *
 *   - `packs` — rows carrying a GS1 serial. Each one is an identified physical
 *     box, so the user can be asked *which* one to consume.
 *   - `bulk`  — rows without a serial: an anonymous count.
 *
 * A group can hold both (three scanned packs plus an older hand-typed row of
 * the same batch).
 *
 * FEFO ordering: expiry_date ascending, nulls last, ties broken by the earliest
 * `created_at` in the group. Only lots with `quantity > 0` are included.
 *
 * Derived from the cached stock so the lot selection modal works offline:
 * no extra HTTP call, and the stock's own cache (seeded by `useStockList()`
 * or `useStock(id)`) is the single source of truth. Use
 * `findCachedStock(queryClient, id)` to fetch the stock from whichever
 * cache has it.
 *
 * @returns {Array<{
 *   key: string,
 *   lot_number: string | null,
 *   expiry_date: string | null,
 *   quantity: number,
 *   created_at: string,
 *   packs: Array<{ lot_id: number, serial_number: string, quantity: number, created_at: string }>,
 *   bulk: Array<{ lot_id: number, quantity: number, created_at: string }>,
 * }>}
 */
export function lotsForSelection(stock) {
  if (!stock || !Array.isArray(stock.lots)) return []

  return groupLots(stock.lots).map(({ rows, ...group }) => {
    const packs = []
    const bulk = []
    for (const lot of rows) {
      const row = { lot_id: lot.id, quantity: lot.quantity, created_at: lot.created_at ?? '' }
      if (lot.serial_number) packs.push({ ...row, serial_number: lot.serial_number })
      else bulk.push(row)
    }
    return { ...group, packs, bulk }
  })
}

/**
 * Group raw lot objects by `(lot_number, expiry_date)`, preserving the lots
 * themselves in `rows`.
 *
 * The shared core behind both `lotsForSelection` (which maps the rows into the
 * consumption wire shape) and the stock detail list (which needs the full lot,
 * `updated_at` included, to delete an individual box). One grouping rule, two
 * consumers — a second implementation would drift.
 *
 * @param lots raw lots as the API returns them
 * @param minQuantity lots below this are dropped. Defaults to 1, so consumption
 *   never offers an empty lot; pass 0 to render whatever the server sent.
 * @returns FEFO-ordered groups, `rows` ordered by `created_at`
 */
export function groupLots(lots, { minQuantity = 1 } = {}) {
  if (!Array.isArray(lots)) return []

  const groups = new Map()
  for (const lot of lots) {
    if ((lot.quantity ?? 0) < minQuantity) continue
    const lotNumber = lot.lot_number || null
    const expiryDate = lot.expiry_date ?? null
    const key = `${lotNumber ?? ''}|${expiryDate ?? ''}`
    const createdAt = lot.created_at ?? ''

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        lot_number: lotNumber,
        expiry_date: expiryDate,
        quantity: 0,
        created_at: createdAt,
        rows: [],
      })
    }
    const group = groups.get(key)
    group.quantity += lot.quantity ?? 0
    if (createdAt && (!group.created_at || createdAt < group.created_at)) {
      group.created_at = createdAt
    }
    group.rows.push(lot)
  }

  const result = [...groups.values()]
  for (const group of result) {
    group.rows.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
  }
  return result.sort(fefoCompare)
}

/**
 * Turn a chosen group into the wire format the API expects.
 *
 * Chosen packs are consumed first, in the order they were picked out of the
 * group; whatever is still needed comes from the group's unserialized rows. A
 * pack normally holds a single unit, but the model does not forbid more, so the
 * allocation caps at each row's own quantity rather than assuming 1.
 *
 * @returns {Array<{ lot_id: number, quantity: number }>}
 */
export function allocateFromGroup(group, needed, chosenPackLotIds = []) {
  if (!group || needed <= 0) return []
  const chosen = new Set(chosenPackLotIds)
  const selections = []
  let remaining = needed

  for (const pack of group.packs) {
    if (remaining <= 0) break
    if (!chosen.has(pack.lot_id)) continue
    const take = Math.min(pack.quantity, remaining)
    selections.push({ lot_id: pack.lot_id, quantity: take })
    remaining -= take
  }
  for (const row of group.bulk) {
    if (remaining <= 0) break
    const take = Math.min(row.quantity, remaining)
    selections.push({ lot_id: row.lot_id, quantity: take })
    remaining -= take
  }
  return selections
}

/** Total units held in a group's unserialized rows. */
export function bulkQuantity(group) {
  return group.bulk.reduce((sum, row) => sum + row.quantity, 0)
}

/**
 * Whether consuming from this group needs the user to say *which* box.
 *
 * A pack step only earns its place when there is a real choice to make: a group
 * holding a single identified pack has no ambiguity, so it is taken
 * automatically however many units come out of it. The rule lives here, next to
 * the grouping that builds `packs`, because every consumption entry point must
 * skip on the same condition — two copies of it would drift apart silently.
 */
export function needsPackChoice(group) {
  return group.packs.length > 1
}

// Only ever called on the groups `groupLots` builds, whose `created_at` is
// normalised to a string there — no nullish guard needed, and one that could
// never fire would only suggest the invariant is weaker than it is.
function fefoCompare(a, b) {
  const aDate = a.expiry_date ?? '9999-12-31'
  const bDate = b.expiry_date ?? '9999-12-31'
  if (aDate !== bDate) return aDate.localeCompare(bDate)
  return a.created_at.localeCompare(b.created_at)
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
