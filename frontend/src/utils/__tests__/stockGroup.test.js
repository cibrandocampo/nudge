import { effectiveGroupId } from '../stockGroup'

describe('effectiveGroupId', () => {
  it('returns null for nullish stock', () => {
    expect(effectiveGroupId(null)).toBeNull()
    expect(effectiveGroupId(undefined)).toBeNull()
  })

  it('falls back to owner group when no personal override exists', () => {
    const stock = { id: 1, group: 7, group_name: 'Owner Group', my_group: null, my_group_name: null }
    expect(effectiveGroupId(stock)).toBe(7)
  })

  it('prefers the personal override over the owner group', () => {
    const stock = { id: 1, group: 7, group_name: 'Owner Group', my_group: 9, my_group_name: 'Mine' }
    expect(effectiveGroupId(stock)).toBe(9)
  })

  it('returns null when both group and my_group are null', () => {
    const stock = { id: 1, group: null, my_group: null }
    expect(effectiveGroupId(stock)).toBeNull()
  })

  it('treats my_group=0 as a real id (not nullish)', () => {
    // Defensive: `??` falls through `null` and `undefined` only — ids of 0
    // (unusual for Django, but possible) must NOT silently fall back to
    // ``group``. This pins the chosen operator against future regressions.
    const stock = { id: 1, group: 7, my_group: 0 }
    expect(effectiveGroupId(stock)).toBe(0)
  })

  it('falls back when my_group is undefined (legacy payload)', () => {
    // Pre-T176 stock payloads in queued offline mutations may lack the
    // ``my_group`` key entirely. Treating undefined the same as null keeps
    // the legacy "owner group is shown" behaviour during the transition.
    const stock = { id: 1, group: 7, group_name: 'Owner Group' }
    expect(effectiveGroupId(stock)).toBe(7)
  })
})
