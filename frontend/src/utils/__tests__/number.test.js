import { parseIntSafe } from '../number'

describe('parseIntSafe', () => {
  it('parses a plain numeric string', () => {
    expect(parseIntSafe('42')).toBe(42)
  })

  it('trims whitespace before parsing', () => {
    expect(parseIntSafe('  42  ')).toBe(42)
  })

  it('truncates float strings like parseInt', () => {
    expect(parseIntSafe('3.7')).toBe(3)
  })

  it('returns the default fallback for unparseable strings', () => {
    expect(parseIntSafe('abc')).toBe(0)
  })

  it('returns a custom fallback for unparseable strings', () => {
    expect(parseIntSafe('abc', 99)).toBe(99)
  })

  it('returns the fallback for empty string', () => {
    expect(parseIntSafe('')).toBe(0)
  })

  it('returns the fallback for null', () => {
    expect(parseIntSafe(null)).toBe(0)
  })

  it('returns the fallback for undefined', () => {
    expect(parseIntSafe(undefined)).toBe(0)
  })

  it('honours a custom fallback for undefined', () => {
    expect(parseIntSafe(undefined, 1)).toBe(1)
  })
})
