import { needsAttention } from './stockAlerts'

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
 * Searchable: the product name, the names of the viewer's categories for it,
 * and any batch number among its lots — the three things a person actually
 * types. `gtin` is deliberately **not** searchable: it is a 14-digit code that
 * would only ever match by pasting, and a stray digit would pull in unrelated
 * products.
 *
 * An empty query matches everything, so callers can apply this unconditionally.
 */
export function matchesStock(stock, query, groups = []) {
  const needle = normalise(query).trim()
  if (!needle) return true
  if (normalise(stock?.name).includes(needle)) return true
  const mine = stock?.my_groups ?? []
  if (groups.some((group) => mine.includes(group.id) && normalise(group.name).includes(needle))) return true
  return (stock?.lots ?? []).some((lot) => lot.lot_number && normalise(lot.lot_number).includes(needle))
}

/** The predicate behind each filter chip, keyed by the chip's id. */
function chipPredicate(chipId) {
  if (chipId === 'featured') return (stock) => Boolean(stock.is_pinned)
  if (chipId === 'attention') return needsAttention
  if (chipId === 'all') return () => true
  if (chipId === 'ungrouped') return (stock) => (stock.my_groups ?? []).length === 0
  const groupId = Number(chipId.replace(/^group-/, ''))
  return (stock) => (stock.my_groups ?? []).includes(groupId)
}

/**
 * The products to list, alphabetically, each once.
 *
 * With text in the search box the active filter is ignored: the search always
 * covers the whole inventory, so a product outside Featured can still be found.
 */
export function filterStocks(stocks, groups, chipId, query, locale) {
  const list = (stocks ?? []).filter(
    query?.trim() ? (stock) => matchesStock(stock, query, groups ?? []) : chipPredicate(chipId),
  )
  return list.sort((a, b) => a.name.localeCompare(b.name, locale))
}

/**
 * The chips to offer, in their fixed order: Featured, Attention, All, the
 * user's categories, No category.
 *
 * Each counts what pressing it shows, over the whole inventory; a product in
 * two categories counts in both, so they need not add up to All. A chip with
 * nothing to show is dropped, except All (always a way back) and Attention
 * (always visible: «0» is an answer too). «No category» only appears once the
 * user has categories: without any it would be All under another name.
 *
 * Returns descriptors, not text: `kind` and `name` are for the caller to
 * translate, keeping this module free of i18next.
 */
export function buildFilterChips(stocks, groups) {
  const list = stocks ?? []
  const count = (id) => list.filter(chipPredicate(id)).length

  const chips = []
  const featured = count('featured')
  if (featured > 0) chips.push({ id: 'featured', kind: 'featured', name: null, count: featured })
  chips.push({ id: 'attention', kind: 'attention', name: null, count: count('attention') })
  chips.push({ id: 'all', kind: 'all', name: null, count: list.length })

  for (const group of groups ?? []) {
    const id = `group-${group.id}`
    const inGroup = count(id)
    if (inGroup > 0) chips.push({ id, kind: 'group', name: group.name, count: inGroup })
  }

  const ungrouped = count('ungrouped')
  if ((groups ?? []).length > 0 && ungrouped > 0) {
    chips.push({ id: 'ungrouped', kind: 'ungrouped', name: null, count: ungrouped })
  }
  return chips
}

/**
 * The filter in effect. With no choice yet (`null`), Featured if there is any,
 * else All. A chosen filter that no longer exists (last featured product
 * removed, category deleted) falls back to All.
 */
export function resolveChip(chosen, chips) {
  if (chosen && chips.some((chip) => chip.id === chosen)) return chosen
  if (chosen) return 'all'
  return chips.some((chip) => chip.id === 'featured') ? 'featured' : 'all'
}
