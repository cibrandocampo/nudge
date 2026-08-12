import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readCollapsedGroups, readInventoryScroll, writeCollapsedGroups, writeInventoryScroll } from '../inventoryPrefs'

const COLLAPSED_KEY = 'inventory_collapsed_groups'
const SCROLL_KEY = 'inventory_scroll_y'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readCollapsedGroups', () => {
  it('returns nothing collapsed when the preference has never been written', () => {
    expect(readCollapsedGroups()).toEqual({})
  })

  it('reads back what was written', () => {
    writeCollapsedGroups({ 10: true, ungrouped: true })
    expect(readCollapsedGroups()).toEqual({ 10: true, ungrouped: true })
  })

  it.each([
    ['invalid JSON', 'not json at all'],
    ['a JSON array', '[1,2,3]'],
    ['a JSON scalar', '42'],
    ['null', 'null'],
  ])('falls back to nothing collapsed when the stored value is %s', (_label, raw) => {
    // An unreadable preference must never blank the page: everything expanded
    // is the safe reading, because the user still sees their stock.
    localStorage.setItem(COLLAPSED_KEY, raw)
    expect(readCollapsedGroups()).toEqual({})
  })

  it('ignores entries that are not exactly true', () => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify({ 10: true, 20: false, 30: 'yes', 40: 1 }))
    expect(readCollapsedGroups()).toEqual({ 10: true })
  })

  it('drops sections that no longer exist', () => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify({ 10: true, 99: true }))
    expect(readCollapsedGroups(['10', 'ungrouped'])).toEqual({ 10: true })
  })

  it('accepts numeric section keys, which is how group ids arrive', () => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify({ 10: true }))
    expect(readCollapsedGroups([10, 'ungrouped'])).toEqual({ 10: true })
  })

  it('survives storage being unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(readCollapsedGroups()).toEqual({})
  })
})

describe('writeCollapsedGroups', () => {
  it('prunes deleted sections as it writes', () => {
    writeCollapsedGroups({ 10: true, 99: true }, ['10'])
    expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY))).toEqual({ 10: true })
  })

  it('stores only the collapsed sections, not the expanded ones', () => {
    writeCollapsedGroups({ 10: true, 20: false })
    expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY))).toEqual({ 10: true })
  })

  it('treats a missing map as nothing collapsed', () => {
    writeCollapsedGroups(undefined)
    expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY))).toEqual({})
  })

  it('survives storage being unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => writeCollapsedGroups({ 10: true })).not.toThrow()
  })
})

describe('inventory scroll position', () => {
  it('starts at the top when nothing was saved', () => {
    expect(readInventoryScroll()).toBe(0)
  })

  it('round-trips a position', () => {
    writeInventoryScroll(842.6)
    expect(readInventoryScroll()).toBe(843)
  })

  it.each([
    ['a negative offset', -50, 0],
    ['no argument', undefined, 0],
  ])('clamps %s to the top', (_label, input, expected) => {
    writeInventoryScroll(input)
    expect(readInventoryScroll()).toBe(expected)
  })

  it.each([
    ['garbage', 'over there'],
    ['a negative number', '-10'],
  ])('ignores %s in storage', (_label, raw) => {
    sessionStorage.setItem(SCROLL_KEY, raw)
    expect(readInventoryScroll()).toBe(0)
  })

  it('survives storage being unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(readInventoryScroll()).toBe(0)
    expect(() => writeInventoryScroll(100)).not.toThrow()
  })
})
