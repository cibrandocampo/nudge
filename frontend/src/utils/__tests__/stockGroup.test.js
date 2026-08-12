import { effectiveGroupId, effectiveGroupName } from '../stockGroup'

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

describe('effectiveGroupName', () => {
  it('returns null for nullish stock', () => {
    expect(effectiveGroupName(null)).toBeNull()
    expect(effectiveGroupName(undefined)).toBeNull()
  })

  it("falls back to the owner's group name when there is no override", () => {
    const stock = { id: 1, group: 7, group_name: 'Owner Group', my_group: null, my_group_name: null }
    expect(effectiveGroupName(stock)).toBe('Owner Group')
  })

  it('prefers the personal override name', () => {
    const stock = { id: 1, group: 7, group_name: 'Owner Group', my_group: 9, my_group_name: 'Mine' }
    expect(effectiveGroupName(stock)).toBe('Mine')
  })

  it('branches on the id, not on the name', () => {
    // An override with an id but no name means "in my group, name unknown" —
    // it must NOT leak the owner's name, which belongs to a different group.
    const stock = { id: 1, group: 7, group_name: 'Owner Group', my_group: 9, my_group_name: null }
    expect(effectiveGroupName(stock)).toBeNull()
  })

  it('returns null when the stock is in no group at all', () => {
    expect(effectiveGroupName({ id: 1, group: null, my_group: null })).toBeNull()
    expect(effectiveGroupName({ id: 1 })).toBeNull()
  })

  it('agrees with effectiveGroupId about which group is in force', () => {
    const stock = { id: 1, group: 7, group_name: 'Owner Group', my_group: 9, my_group_name: 'Mine' }
    expect(effectiveGroupId(stock)).toBe(9)
    expect(effectiveGroupName(stock)).toBe('Mine')
  })
})
