import { formatAbsoluteDate, formatRelativeTime } from '../time'

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
