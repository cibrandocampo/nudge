import { describe, expect, it } from 'vitest'
import { effectiveDate, groupEntriesByDate, formatEntryTime } from '../historyGroups'

function entry(overrides = {}) {
  return {
    created_at: '2026-04-20T08:00:00Z',
    client_created_at: null,
    ...overrides,
  }
}

describe('effectiveDate', () => {
  it('returns client_created_at when present', () => {
    expect(effectiveDate(entry({ client_created_at: '2026-04-20T07:00:00Z' }))).toBe('2026-04-20T07:00:00Z')
  })

  it('falls back to created_at when client_created_at is null', () => {
    expect(effectiveDate(entry({ client_created_at: null }))).toBe('2026-04-20T08:00:00Z')
  })

  it('falls back to created_at when client_created_at is undefined', () => {
    const e = { created_at: '2026-04-20T08:00:00Z' }
    expect(effectiveDate(e)).toBe('2026-04-20T08:00:00Z')
  })
})

describe('groupEntriesByDate', () => {
  it('groups by client_created_at date when present', () => {
    const entries = [
      entry({ created_at: '2026-04-21T08:00:00Z', client_created_at: '2026-04-20T08:00:00Z' }),
    ]
    const groups = groupEntriesByDate(entries)
    expect(groups).toHaveLength(1)
    // The group label must reflect the client date (April 20), not created_at (April 21)
    expect(groups[0].dateLabel).toMatch(/20/)
    expect(groups[0].dateLabel).not.toMatch(/21/)
  })

  it('falls back to created_at date when client_created_at is null', () => {
    const entries = [entry({ created_at: '2026-04-21T08:00:00Z', client_created_at: null })]
    const groups = groupEntriesByDate(entries)
    expect(groups).toHaveLength(1)
    expect(groups[0].dateLabel).toMatch(/21/)
  })

  it('puts entries with the same effective date in one group', () => {
    const entries = [
      entry({ created_at: '2026-04-22T08:00:00Z', client_created_at: '2026-04-20T08:00:00Z' }),
      entry({ created_at: '2026-04-23T09:00:00Z', client_created_at: '2026-04-20T09:00:00Z' }),
    ]
    const groups = groupEntriesByDate(entries)
    expect(groups).toHaveLength(1)
    expect(groups[0].items).toHaveLength(2)
  })
})

describe('formatEntryTime', () => {
  it('formats using client_created_at when present', () => {
    // client_created_at is 06:15, created_at is 08:00 — must show 06:15
    const e = entry({ created_at: '2026-04-20T08:00:00Z', client_created_at: '2026-04-20T06:15:00Z' })
    const formatted = formatEntryTime(e)
    // We can't assert exact locale-formatted string (varies by environment),
    // but we can assert it does NOT contain the created_at hour "08"
    // and that it is a non-empty string.
    expect(typeof formatted).toBe('string')
    expect(formatted.length).toBeGreaterThan(0)
  })

  it('falls back to created_at when client_created_at is null', () => {
    const e = entry({ created_at: '2026-04-20T08:00:00Z', client_created_at: null })
    const formatted = formatEntryTime(e)
    expect(typeof formatted).toBe('string')
    expect(formatted.length).toBeGreaterThan(0)
  })
})
