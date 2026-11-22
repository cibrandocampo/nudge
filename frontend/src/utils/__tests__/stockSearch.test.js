import { describe, expect, it } from 'vitest'
import { buildFilterChips, filterStocks, matchesStock, normalise, resolveChip } from '../stockSearch'

const stock = (over = {}) => ({
  id: 1,
  name: 'Water filter',
  my_groups: [],
  is_pinned: false,
  gtin: '',
  stock_severity: 'ok',
  expiry_severity: 'none',
  lots: [],
  ...over,
})

const GROUPS = [
  { id: 10, name: 'Diabetes' },
  { id: 20, name: 'Botiquín' },
]

const names = (list) => list.map((s) => s.name)

describe('normalise', () => {
  it('casefolds and strips diacritics', () => {
    expect(normalise('Hidroferól')).toBe('hidroferol')
    expect(normalise('BOTIQUÍN')).toBe('botiquin')
  })

  it('treats null and undefined as empty', () => {
    expect(normalise(null)).toBe('')
    expect(normalise(undefined)).toBe('')
  })
})

describe('matchesStock', () => {
  it('matches everything when the query is empty or only spaces', () => {
    expect(matchesStock(stock(), '')).toBe(true)
    expect(matchesStock(stock(), '   ')).toBe(true)
  })

  it('matches a fragment of the name', () => {
    expect(matchesStock(stock({ name: 'Hidroferol drops' }), 'ferol')).toBe(true)
    expect(matchesStock(stock({ name: 'Hidroferol drops' }), 'aspirin')).toBe(false)
  })

  it.each([
    ['query accented, data plain', 'Hidroferol', 'hidroferól'],
    ['query plain, data accented', 'Hidroferól', 'hidroferol'],
    ['case only', 'HIDROFEROL', 'hidroferol'],
  ])('matches regardless of accents and case (%s)', (_label, name, query) => {
    expect(matchesStock(stock({ name }), query)).toBe(true)
  })

  it('matches the name of any of its categories', () => {
    const filed = stock({ my_groups: [10, 20] })
    expect(matchesStock(filed, 'botiquin', GROUPS)).toBe(true)
    expect(matchesStock(filed, 'diabetes', GROUPS)).toBe(true)
  })

  it('does not match a category the product is not in', () => {
    expect(matchesStock(stock({ my_groups: [10] }), 'botiquin', GROUPS)).toBe(false)
  })

  it('matches a batch number on any of its lots', () => {
    const withLots = stock({
      lots: [
        { id: 1, lot_number: '' },
        { id: 2, lot_number: 'HID-A42' },
      ],
    })
    expect(matchesStock(withLots, 'hid-a')).toBe(true)
    expect(matchesStock(withLots, 'zzz')).toBe(false)
  })

  it('does NOT search the gtin', () => {
    // Closed decision: 14 digits only ever match by pasting, and letting them
    // match would have a stray digit pull in unrelated products.
    const withGtin = stock({ name: 'Ebastine', gtin: '05705244020856' })
    expect(matchesStock(withGtin, '05705244020856')).toBe(false)
    expect(matchesStock(withGtin, '570524')).toBe(false)
  })

  it('survives a stock with no lots array', () => {
    expect(matchesStock({ name: 'Bare' }, 'bare')).toBe(true)
    expect(matchesStock({ name: 'Bare' }, 'other')).toBe(false)
  })
})

describe('filterStocks', () => {
  const population = [
    stock({ id: 1, name: 'Lancets', my_groups: [10] }),
    stock({ id: 2, name: 'Insulin', my_groups: [10, 20], stock_severity: 'low', is_pinned: true }),
    stock({ id: 3, name: 'Aspirin', my_groups: [20], expiry_severity: 'reached' }),
    stock({ id: 4, name: 'Loose item' }),
  ]

  it('lists everything under All, alphabetically', () => {
    expect(names(filterStocks(population, GROUPS, 'all', ''))).toEqual(['Aspirin', 'Insulin', 'Lancets', 'Loose item'])
  })

  it('sorts with the given locale', () => {
    const accented = [stock({ id: 1, name: 'Zinc' }), stock({ id: 2, name: 'Ácido' })]
    expect(names(filterStocks(accented, [], 'all', '', 'es-ES'))).toEqual(['Ácido', 'Zinc'])
  })

  it('narrows to the featured products', () => {
    expect(names(filterStocks(population, GROUPS, 'featured', ''))).toEqual(['Insulin'])
  })

  it('narrows to the products needing attention', () => {
    expect(names(filterStocks(population, GROUPS, 'attention', ''))).toEqual(['Aspirin', 'Insulin'])
  })

  it('shows a product in each of its categories', () => {
    expect(names(filterStocks(population, GROUPS, 'group-10', ''))).toEqual(['Insulin', 'Lancets'])
    expect(names(filterStocks(population, GROUPS, 'group-20', ''))).toEqual(['Aspirin', 'Insulin'])
  })

  it('lists a product in two categories once under All', () => {
    expect(names(filterStocks(population, GROUPS, 'all', '')).filter((name) => name === 'Insulin')).toHaveLength(1)
  })

  it('narrows to the products with no category', () => {
    expect(names(filterStocks(population, GROUPS, 'ungrouped', ''))).toEqual(['Loose item'])
  })

  it('searches the whole inventory, ignoring the active filter', () => {
    expect(names(filterStocks(population, GROUPS, 'featured', 'aspirin'))).toEqual(['Aspirin'])
  })

  it('applies the filter again when the query is only spaces', () => {
    expect(names(filterStocks(population, GROUPS, 'featured', '   '))).toEqual(['Insulin'])
  })

  it('does not reorder the list it was given', () => {
    filterStocks(population, GROUPS, 'all', '')
    expect(population[0].name).toBe('Lancets')
  })

  it('treats missing inputs as empty', () => {
    expect(filterStocks(undefined, undefined, 'all', '')).toEqual([])
    expect(filterStocks([stock({ my_groups: undefined })], undefined, 'ungrouped', 'water')).toHaveLength(1)
  })
})

describe('buildFilterChips', () => {
  const population = [
    stock({ id: 1, name: 'Lancets', my_groups: [10], is_pinned: true }),
    stock({ id: 2, name: 'Insulin', my_groups: [10, 20], stock_severity: 'low' }),
    stock({ id: 3, name: 'Loose item' }),
  ]
  const ids = (chips) => chips.map((chip) => chip.id)
  const countOf = (chips, id) => chips.find((chip) => chip.id === id)?.count

  it('keeps the fixed order', () => {
    expect(ids(buildFilterChips(population, GROUPS))).toEqual([
      'featured',
      'attention',
      'all',
      'group-10',
      'group-20',
      'ungrouped',
    ])
  })

  it('counts a product in each of its categories', () => {
    const chips = buildFilterChips(population, GROUPS)
    expect(countOf(chips, 'group-10')).toBe(2)
    expect(countOf(chips, 'group-20')).toBe(1)
    expect(countOf(chips, 'all')).toBe(3)
  })

  it('drops Featured with nothing featured', () => {
    expect(ids(buildFilterChips([stock()], GROUPS))).not.toContain('featured')
  })

  it('keeps Attention at zero', () => {
    expect(countOf(buildFilterChips([stock()], []), 'attention')).toBe(0)
  })

  it('drops a category with no products', () => {
    expect(ids(buildFilterChips([stock({ my_groups: [10] })], GROUPS))).not.toContain('group-20')
  })

  it('offers no «No category» to someone without categories', () => {
    expect(ids(buildFilterChips([stock()], []))).not.toContain('ungrouped')
  })

  it('offers no «No category» when every product has one', () => {
    expect(ids(buildFilterChips([stock({ my_groups: [10] })], GROUPS))).not.toContain('ungrouped')
  })

  it('carries the name only on category chips', () => {
    const chips = buildFilterChips(population, GROUPS)
    expect(chips.find((chip) => chip.id === 'group-10').name).toBe('Diabetes')
    expect(chips.find((chip) => chip.id === 'all').name).toBeNull()
  })

  it('treats missing inputs as empty', () => {
    expect(ids(buildFilterChips(undefined, undefined))).toEqual(['attention', 'all'])
  })
})

describe('resolveChip', () => {
  const withFeatured = [{ id: 'featured' }, { id: 'attention' }, { id: 'all' }, { id: 'group-10' }]
  const withoutFeatured = [{ id: 'attention' }, { id: 'all' }]

  it('opens on Featured when there is any', () => {
    expect(resolveChip(null, withFeatured)).toBe('featured')
  })

  it('opens on All with nothing featured', () => {
    expect(resolveChip(null, withoutFeatured)).toBe('all')
  })

  it('keeps a choice that still exists', () => {
    expect(resolveChip('group-10', withFeatured)).toBe('group-10')
  })

  it('falls back to All when the chosen filter is gone', () => {
    expect(resolveChip('featured', withoutFeatured)).toBe('all')
    expect(resolveChip('group-10', withoutFeatured)).toBe('all')
  })
})

describe('the attention chip and regulatory alerts', () => {
  it('includes a product whose only alert is regulatory', () => {
    const population = [
      stock({ id: 1, name: 'Healthy' }),
      stock({
        id: 2,
        name: 'Fast-acting insulin',
        regulatory: { fetch_status: 'ok', fetched_at: '2026-11-10T01:00:00Z', supply_severity: 'danger' },
      }),
    ]
    expect(names(filterStocks(population, GROUPS, 'attention', ''))).toEqual(['Fast-acting insulin'])
  })
})
