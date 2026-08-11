import { describe, expect, it } from 'vitest'
import { buildFilterChips, filterStocks, matchesStock, normalise } from '../stockSearch'

const stock = (over = {}) => ({
  id: 1,
  name: 'Water filter',
  group: null,
  group_name: null,
  my_group: null,
  my_group_name: null,
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

  it('matches the effective group name', () => {
    expect(matchesStock(stock({ group: 20, group_name: 'Botiquín' }), 'botiquin')).toBe(true)
  })

  it("prefers the viewer's own group name over the owner's", () => {
    const shared = stock({ group: 20, group_name: 'Botiquín', my_group: 10, my_group_name: 'Diabetes' })
    expect(matchesStock(shared, 'diabetes')).toBe(true)
    expect(matchesStock(shared, 'botiquin')).toBe(false)
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
    stock({ id: 1, name: 'Insulin', group: 10, group_name: 'Diabetes', stock_severity: 'low' }),
    stock({ id: 2, name: 'Lancets', group: 10, group_name: 'Diabetes' }),
    stock({ id: 3, name: 'Aspirin', group: 20, group_name: 'Botiquín', expiry_severity: 'reached' }),
    stock({ id: 4, name: 'Loose item' }),
    stock({ id: 5, name: 'Orphan', group: 99, group_name: 'Deleted group' }),
  ]

  it('returns everything under the all chip with no query', () => {
    expect(filterStocks(population, GROUPS, 'all', '')).toHaveLength(5)
  })

  it('narrows to a group', () => {
    expect(names(filterStocks(population, GROUPS, 'group-10', ''))).toEqual(['Insulin', 'Lancets'])
  })

  it('narrows to the products needing attention', () => {
    expect(names(filterStocks(population, GROUPS, 'attention', ''))).toEqual(['Insulin', 'Aspirin'])
  })

  it('treats a stock in an unknown group as ungrouped', () => {
    // A group the viewer cannot see (deleted, or the owner's own) must not
    // strand the product outside every chip.
    expect(names(filterStocks(population, GROUPS, 'ungrouped', ''))).toEqual(['Loose item', 'Orphan'])
  })

  it('applies the chip and the query together', () => {
    expect(names(filterStocks(population, GROUPS, 'group-10', 'lanc'))).toEqual(['Lancets'])
    expect(filterStocks(population, GROUPS, 'group-20', 'lanc')).toEqual([])
  })

  it('treats missing inputs as empty', () => {
    expect(filterStocks(undefined, undefined, 'all', '')).toEqual([])
  })
})

describe('buildFilterChips', () => {
  const population = [
    stock({ id: 1, name: 'Insulin', group: 10, group_name: 'Diabetes', stock_severity: 'low' }),
    stock({ id: 2, name: 'Lancets', group: 10, group_name: 'Diabetes' }),
    stock({ id: 3, name: 'Aspirin', group: 20, group_name: 'Botiquín' }),
    stock({ id: 4, name: 'Loose item' }),
  ]

  it('offers all, attention, one per non-empty group, and ungrouped', () => {
    const chips = buildFilterChips(population, GROUPS, '')
    expect(chips.map((c) => c.id)).toEqual(['all', 'attention', 'group-10', 'group-20', 'ungrouped'])
    expect(chips.map((c) => c.count)).toEqual([4, 1, 2, 1, 1])
  })

  it('drops chips that would show nothing', () => {
    const healthy = [stock({ id: 1, name: 'Insulin', group: 10, group_name: 'Diabetes' })]
    const chips = buildFilterChips(healthy, GROUPS, '')
    // No attention (all healthy), no Botiquín (empty), no ungrouped.
    expect(chips.map((c) => c.id)).toEqual(['all', 'group-10'])
  })

  it('keeps the all chip even when the query matches nothing', () => {
    const chips = buildFilterChips(population, GROUPS, 'zzzzz')
    expect(chips.map((c) => c.id)).toEqual(['all'])
    expect(chips[0].count).toBe(0)
  })

  it('counts after the query, so a chip says what clicking would show', () => {
    const chips = buildFilterChips(population, GROUPS, 'in')
    // 'Insulin' and 'Aspirin' contain "in"; Lancets and Loose item do not.
    expect(chips.find((c) => c.id === 'all').count).toBe(2)
    expect(chips.find((c) => c.id === 'group-10').count).toBe(1)
    expect(chips.find((c) => c.id === 'group-20').count).toBe(1)
  })

  it('carries the group name for group chips and nothing for the rest', () => {
    const chips = buildFilterChips(population, GROUPS, '')
    expect(chips.find((c) => c.id === 'group-10').name).toBe('Diabetes')
    expect(chips.find((c) => c.id === 'all').name).toBeNull()
  })

  it('treats missing inputs as empty', () => {
    expect(buildFilterChips(undefined, undefined, '')).toEqual([{ id: 'all', kind: 'all', name: null, count: 0 }])
  })
})
