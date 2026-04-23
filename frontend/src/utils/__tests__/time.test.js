import { formatAbsoluteDate, formatRelativeTime, formatShortDate } from '../time'

describe('formatAbsoluteDate', () => {
  it('returns dash for null', () => {
    expect(formatAbsoluteDate(null)).toBe('—')
  })

  it('returns dash for undefined', () => {
    expect(formatAbsoluteDate(undefined)).toBe('—')
  })

  it('returns dash for empty string', () => {
    expect(formatAbsoluteDate('')).toBe('—')
  })

  it('formats a date in the current year without year', () => {
    const now = new Date()
    const iso = new Date(now.getFullYear(), 1, 25, 14, 30).toISOString()
    const result = formatAbsoluteDate(iso)
    expect(result).toBeTruthy()
    expect(result).not.toBe('—')
  })

  it('formats a date in a different year with year', () => {
    const iso = '2020-03-15T09:00:00Z'
    const result = formatAbsoluteDate(iso)
    expect(result).toContain('2020')
  })
})

describe('formatRelativeTime', () => {
  it('returns "Never logged" for null', () => {
    expect(formatRelativeTime(null)).toBe('Never logged')
  })

  it('returns "Due now" for a time slightly in the past (< 1h)', () => {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60000).toISOString()
    expect(formatRelativeTime(thirtyMinAgo)).toBe('Due now')
  })

  it('returns overdue for a time more than 1h in the past', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600000).toISOString()
    expect(formatRelativeTime(threeHoursAgo)).toMatch(/Overdue by 3h/)
  })

  it('returns minutes for < 1h in the future', () => {
    const inThirtyMin = new Date(Date.now() + 30 * 60000).toISOString()
    expect(formatRelativeTime(inThirtyMin)).toMatch(/In 30 min/)
  })

  it('returns hours for < 24h in the future', () => {
    const inFiveHours = new Date(Date.now() + 5 * 3600000).toISOString()
    expect(formatRelativeTime(inFiveHours)).toMatch(/In 5h/)
  })

  it('returns "In 1 day" for ~24h in the future', () => {
    const inOneDay = new Date(Date.now() + 24 * 3600000).toISOString()
    expect(formatRelativeTime(inOneDay)).toBe('In 1 day')
  })

  it('returns N days for multiple days in the future', () => {
    const inThreeDays = new Date(Date.now() + 72 * 3600000).toISOString()
    expect(formatRelativeTime(inThreeDays)).toMatch(/In 3 days/)
  })
})

describe('formatShortDate', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(formatShortDate(null)).toBe('')
    expect(formatShortDate(undefined)).toBe('')
    expect(formatShortDate('')).toBe('')
  })

  it('returns empty string for an invalid date string', () => {
    expect(formatShortDate('not-a-date')).toBe('')
  })

  it('formats a YYYY-MM-DD date with day, short month and year by default', () => {
    const out = formatShortDate('2025-03-15')
    expect(out).toContain('2025')
    expect(out).toContain('15')
    expect(out.toLowerCase()).toMatch(/mar/)
  })

  it('omits the year when withYear is false', () => {
    const out = formatShortDate('2025-03-15', { withYear: false })
    expect(out).not.toContain('2025')
    expect(out).toContain('15')
  })

  it('omits the day when withDay is false', () => {
    const out = formatShortDate('2025-03-15', { withDay: false })
    expect(out).not.toContain('15')
    expect(out).toContain('2025')
  })

  it('accepts a full ISO datetime string', () => {
    const out = formatShortDate('2020-03-15T09:00:00Z')
    expect(out).toContain('2020')
  })
})
