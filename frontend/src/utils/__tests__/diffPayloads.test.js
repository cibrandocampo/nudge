import { describe, expect, it } from 'vitest'
import { diffPayloads } from '../diffPayloads'

describe('diffPayloads', () => {
  it('returns an empty array when both payloads are identical', () => {
    const a = { name: 'Pills', interval_hours: 24 }
    expect(diffPayloads(a, { ...a })).toEqual([])
  })

  it('returns an empty array when either side is falsy', () => {
    expect(diffPayloads(null, { name: 'x' })).toEqual([])
    expect(diffPayloads({ name: 'x' }, null)).toEqual([])
    expect(diffPayloads(undefined, undefined)).toEqual([])
  })

  it('reports fields that differ with both values', () => {
    const local = { name: 'Pills', interval_hours: 24 }
    const server = { name: 'Vitamins', interval_hours: 24 }
    expect(diffPayloads(local, server)).toEqual([{ field: 'name', localValue: 'Pills', serverValue: 'Vitamins' }])
  })

  it('compares arrays structurally (no false positives on same contents)', () => {
    const local = { shared_with: [2, 3] }
    const server = { shared_with: [2, 3] }
    expect(diffPayloads(local, server)).toEqual([])
  })

  it('reports arrays whose contents differ', () => {
    const local = { shared_with: [2, 3] }
    const server = { shared_with: [2] }
    const result = diffPayloads(local, server)
    expect(result).toHaveLength(1)
    expect(result[0].field).toBe('shared_with')
  })

  it('skips fields that exist on only one side', () => {
    // `quantity` is a computed server field the PATCH body never sets;
    // showing "—" on the local side would be noise, so skip it.
    const local = { name: 'Pills' }
    const server = { name: 'Pills', quantity: 10 }
    expect(diffPayloads(local, server)).toEqual([])
  })

  it('handles nested objects via JSON comparison', () => {
    const local = { patch: { a: 1, b: 2 } }
    const server = { patch: { a: 1, b: 3 } }
    const result = diffPayloads(local, server)
    expect(result).toHaveLength(1)
    expect(result[0].field).toBe('patch')
  })

  it('reports a diff when one side is null and the other is not', () => {
    const local = { description: 'text' }
    const server = { description: null }
    const result = diffPayloads(local, server)
    expect(result).toEqual([{ field: 'description', localValue: 'text', serverValue: null }])
  })

  it('reports a diff when types differ (string vs number)', () => {
    const local = { interval_hours: '24' }
    const server = { interval_hours: 24 }
    const result = diffPayloads(local, server)
    expect(result).toHaveLength(1)
    expect(result[0].field).toBe('interval_hours')
  })
})
