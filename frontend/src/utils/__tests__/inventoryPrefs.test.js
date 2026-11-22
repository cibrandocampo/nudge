import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearLegacyInventoryPrefs,
  readInventoryFilter,
  readInventoryScroll,
  readSwipeHintSeen,
  writeInventoryFilter,
  writeInventoryScroll,
  writeSwipeHintSeen,
} from '../inventoryPrefs'

const SCROLL_KEY = 'inventory_scroll_y'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('clearLegacyInventoryPrefs', () => {
  it('forgets the folded sections of the old list', () => {
    localStorage.setItem('inventory_collapsed_groups', '{"10":true}')
    clearLegacyInventoryPrefs()
    expect(localStorage.getItem('inventory_collapsed_groups')).toBeNull()
  })

  it('survives storage being unavailable', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => clearLegacyInventoryPrefs()).not.toThrow()
  })
})

describe('inventory filter', () => {
  it('has no choice until one is made', () => {
    expect(readInventoryFilter()).toBeNull()
  })

  it('round-trips the chosen filter', () => {
    writeInventoryFilter('group-10')
    expect(readInventoryFilter()).toBe('group-10')
  })

  it('lives in the session, so a new visit starts from the default', () => {
    writeInventoryFilter('attention')
    expect(sessionStorage.getItem('inventory_filter')).toBe('attention')
    expect(localStorage.getItem('inventory_filter')).toBeNull()
  })

  it('reads as no choice when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readInventoryFilter()).toBeNull()
  })

  it('survives a failed write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full')
    })
    expect(() => writeInventoryFilter('all')).not.toThrow()
  })
})

describe('swipe hint', () => {
  it('has not been seen on a new device', () => {
    expect(readSwipeHintSeen()).toBe(false)
  })

  it('stays seen once marked', () => {
    writeSwipeHintSeen()
    expect(readSwipeHintSeen()).toBe(true)
  })

  it('counts as seen when storage is unavailable, so it never nags', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readSwipeHintSeen()).toBe(true)
  })

  it('survives a failed write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full')
    })
    expect(() => writeSwipeHintSeen()).not.toThrow()
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
