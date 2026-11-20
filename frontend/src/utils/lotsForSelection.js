/**
 * Today as the lot-expiry comparisons read it: midnight UTC of the current
 * date, the same instant the stock detail page shares with its lot rows. A lot
 * whose `expiry_date` is on or before it has expired — it expires *on* that
 * day, as the backend's `date.today()` reads it.
 *
 * Callers compute it once and pass it down, so a list and its tests never
 * disagree about when "now" is.
 */
export function expiryToday(now = new Date()) {
  return new Date(now.toISOString().slice(0, 10))
}

/** Whether a lot can be consumed: it holds units and has not expired. */
function isConsumable(lot, today) {
  if ((lot.quantity ?? 0) <= 0) return false
  return lot.expiry_date == null || new Date(lot.expiry_date) > today
}

// Soonest expiry first, undated last. The first key of every lot order in the
// app — consumption and the stock detail list alike.
function byExpiry(a, b) {
  const aDate = a.expiry_date ?? '9999-12-31'
  const bDate = b.expiry_date ?? '9999-12-31'
  return aDate.localeCompare(bDate)
}

// Missing text fields sort first, as the backend's empty strings do.
const text = (value) => value ?? ''

// Only ever called on consumable lots, whose `quantity` is a positive number.
function consumptionCompare(a, b) {
  return (
    byExpiry(a, b) ||
    text(a.lot_number).localeCompare(text(b.lot_number)) ||
    a.quantity - b.quantity ||
    text(a.created_at).localeCompare(text(b.created_at))
  )
}

/**
 * The lots of a stock in the order they are consumed — the one definition of
 * that order on the client. It replicates the backend's
 * `Stock.consumable_lots()`, which stays the reference:
 *
 *   1. never an expired lot (`expiry_date <= today`) nor an empty one;
 *   2. expiry ascending, undated last;
 *   3. then `lot_number`, so units of one printed batch stay together;
 *   4. then `quantity` ascending — the opened box before a full one;
 *   5. then `created_at`.
 *
 * Used by the lot picker (through `lotsForSelection`) and by the optimistic
 * consume, so what the screen predicts is what the server does.
 *
 * @param lots raw lots as the API returns them
 * @param today from `expiryToday()`
 */
export function consumptionOrder(lots, today) {
  if (!Array.isArray(lots)) return []
  return lots.filter((lot) => isConsumable(lot, today)).sort(consumptionCompare)
}

// Bucket lots by `(lot_number, expiry_date)` — what is printed on the unit —
// keeping the input order both across groups (first appearance) and inside
// each group's `rows`.
function collectGroups(lots) {
  const groups = new Map()
  for (const lot of lots) {
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
  return [...groups.values()]
}

/**
 * Build the lot-selection list from a cached Stock object: what the user picks
 * from when a consumption needs a lot.
 *
 * The user is asked the **lot**, never the box: a unit carries its lot number
 * and expiry, not the serial of the box it came out of. So the list holds one
 * entry per `(lot_number, expiry_date)` group, and inside a group the units are
 * taken in consumption order — the opened box first (see `allocateFromGroup`).
 *
 * Expired and empty lots are not offered; groups and their rows follow
 * `consumptionOrder`.
 *
 * Derived from the cached stock so the lot selection modal works offline:
 * no extra HTTP call, and the stock's own cache (seeded by `useStockList()`
 * or `useStock(id)`) is the single source of truth. Use
 * `findCachedStock(queryClient, id)` to fetch the stock from whichever
 * cache has it.
 *
 * @param stock a cached Stock object; anything malformed yields `[]`
 * @param today from `expiryToday()`
 * @returns {Array<{
 *   key: string,
 *   lot_number: string | null,
 *   expiry_date: string | null,
 *   quantity: number,
 *   rows: Array<{ lot_id: number, quantity: number }>,
 * }>}
 */
export function lotsForSelection(stock, today) {
  if (!stock || !Array.isArray(stock.lots)) return []

  return collectGroups(consumptionOrder(stock.lots, today)).map((group) => ({
    key: group.key,
    lot_number: group.lot_number,
    expiry_date: group.expiry_date,
    quantity: group.quantity,
    rows: group.rows.map((lot) => ({ lot_id: lot.id, quantity: lot.quantity })),
  }))
}

/**
 * Whether consuming from this stock needs the user to choose a lot: only when
 * there is more than one group to choose from. The same rule as the backend's
 * `requires_lot_selection` (`Stock.has_lot_choice()`).
 *
 * @param groups the result of `lotsForSelection`
 */
export function needsLotChoice(groups) {
  return groups.length > 1
}

/**
 * What confirming a routine does with its linked stock — the one decision the
 * Today page and the routine detail page share.
 *
 * Decided from the cached stock, so it works offline:
 *
 *   - `{ action: 'ask', groups }` — more than one consumable lot: open the
 *     picker with `groups`;
 *   - `{ action: 'log' }` — one lot (or no stock): log without a selection and
 *     let the server apply the consumption order;
 *   - `{ action: 'insufficient' }` — the cached stock has nothing consumable
 *     left (only expired or empty lots): logging would be refused.
 *
 * When the stock is not cached there are no lots to decide from, so the
 * server's `requires_lot_selection` (the same rule, `Stock.has_lot_choice()`)
 * stands in: false → `log`; true → `{ action: 'unavailable' }`, since the
 * picker cannot be built without the lots.
 *
 * @param routine a routine as the API returns it
 * @param stock `findCachedStock(queryClient, routine.stock)`
 * @param today from `expiryToday()`
 */
export function routineLotDecision(routine, stock, today) {
  if (!routine?.stock) return { action: 'log' }
  if (!Array.isArray(stock?.lots)) {
    return routine.requires_lot_selection ? { action: 'unavailable' } : { action: 'log' }
  }
  const groups = lotsForSelection(stock, today)
  if (groups.length === 0) return { action: 'insufficient' }
  if (needsLotChoice(groups)) return { action: 'ask', groups }
  return { action: 'log' }
}

/**
 * Group raw lot objects by `(lot_number, expiry_date)` for the stock detail
 * list, preserving the lots themselves in `rows` (it needs the full lot,
 * `updated_at` included, to delete an individual box).
 *
 * Unlike `lotsForSelection` it does not drop expired lots: the detail list
 * shows them so they can be deleted. Groups are ordered by expiry (undated
 * last), ties by the earliest `created_at`; `rows` by `created_at`.
 *
 * @param lots raw lots as the API returns them
 * @param minQuantity lots below this are dropped. Defaults to 1; pass 0 to
 *   render whatever the server sent.
 */
export function groupLots(lots, { minQuantity = 1 } = {}) {
  if (!Array.isArray(lots)) return []

  const groups = collectGroups(lots.filter((lot) => (lot.quantity ?? 0) >= minQuantity))
  for (const group of groups) {
    group.rows.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
  }
  return groups.sort((a, b) => byExpiry(a, b) || a.created_at.localeCompare(b.created_at))
}

/**
 * Turn a chosen group into the wire format the API expects, taking its rows in
 * the order `lotsForSelection` left them — the opened box first. A row normally
 * holds a single unit, but the model does not forbid more, so the allocation
 * caps at each row's own quantity.
 *
 * @returns {Array<{ lot_id: number, quantity: number }>}
 */
export function allocateFromGroup(group, needed) {
  if (!group || needed <= 0) return []
  const selections = []
  let remaining = needed
  for (const row of group.rows) {
    if (remaining <= 0) break
    const take = Math.min(row.quantity, remaining)
    selections.push({ lot_id: row.lot_id, quantity: take })
    remaining -= take
  }
  return selections
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
