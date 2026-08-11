import { needsAttention } from './stockAlerts'
import { effectiveGroupId, effectiveGroupName } from './stockGroup'

/**
 * Casefold and strip diacritics, so "Hidroferol" matches "hidroferól" and
 * "Gasas" matches "gasas".
 *
 * The app runs in Spanish, Galician and English, where typing the accent is
 * optional in practice and often impossible on a phone keyboard in a hurry.
 * Normalising both sides means it never matters which one carries it.
 */
export function normalise(value) {
  return (
    (value ?? '')
      .toString()
      .normalize('NFD')
      // The combining-diacritics block, written as escapes so the source stays
      // legible and cannot be mangled by an editor normalising the file.
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  )
}

/**
 * Whether a stock matches a free-text query.
 *
 * Searchable: the product name, its effective group name, and any batch
 * number among its lots — the three things a person actually types. `gtin` is
 * deliberately **not** searchable: it is a 14-digit code that would only ever
 * match by pasting, never by typing, and including it would let a stray digit
 * in the query pull in unrelated products.
 *
 * An empty query matches everything, so callers can apply this unconditionally.
 */
export function matchesStock(stock, query) {
  const needle = normalise(query).trim()
  if (!needle) return true
  if (normalise(stock?.name).includes(needle)) return true
  if (normalise(effectiveGroupName(stock)).includes(needle)) return true
  return (stock?.lots ?? []).some((lot) => lot.lot_number && normalise(lot.lot_number).includes(needle))
}

/** Whether a stock belongs to no group the viewer knows about. */
function isUngrouped(stock, knownGroupIds) {
  const id = effectiveGroupId(stock)
  return !id || !knownGroupIds.has(id)
}

/**
 * The predicate behind each filter chip, keyed by the chip's id.
 *
 * `attention` reuses `needsAttention` rather than restating it, so the chip
 * and the alert banner can never disagree about which products are in trouble.
 */
function chipPredicate(chipId, knownGroupIds) {
  if (chipId === 'all') return () => true
  if (chipId === 'attention') return needsAttention
  if (chipId === 'ungrouped') return (stock) => isUngrouped(stock, knownGroupIds)
  const groupId = Number(chipId.replace(/^group-/, ''))
  return (stock) => effectiveGroupId(stock) === groupId
}

/**
 * The stocks a given chip + query combination should show.
 *
 * Chip first, then query — the chip narrows the population and the query
 * searches within it.
 */
export function filterStocks(stocks, groups, chipId, query) {
  const knownGroupIds = new Set((groups ?? []).map((g) => g.id))
  const predicate = chipPredicate(chipId, knownGroupIds)
  return (stocks ?? []).filter((stock) => predicate(stock) && matchesStock(stock, query))
}

/**
 * The chips to offer, with the count each one would show.
 *
 * Counts are computed **after** the query, so they say what clicking would
 * actually produce rather than advertising results the search has already
 * excluded. Chips that would show nothing are dropped — except `all`, which
 * always stays so there is always a way back to the full list.
 *
 * Returns descriptors, not text: `kind` and `name` are for the caller to
 * translate, keeping this module free of i18next.
 */
export function buildFilterChips(stocks, groups, query) {
  const knownGroupIds = new Set((groups ?? []).map((g) => g.id))
  const matching = (stocks ?? []).filter((stock) => matchesStock(stock, query))
  const count = (predicate) => matching.filter(predicate).length

  const chips = [{ id: 'all', kind: 'all', name: null, count: matching.length }]

  const attention = count(needsAttention)
  if (attention > 0) chips.push({ id: 'attention', kind: 'attention', name: null, count: attention })

  for (const group of groups ?? []) {
    const inGroup = count((stock) => effectiveGroupId(stock) === group.id)
    if (inGroup > 0) chips.push({ id: `group-${group.id}`, kind: 'group', name: group.name, count: inGroup })
  }

  const ungrouped = count((stock) => isUngrouped(stock, knownGroupIds))
  if (ungrouped > 0) chips.push({ id: 'ungrouped', kind: 'ungrouped', name: null, count: ungrouped })

  return chips
}
