import { getLocale } from './time'

export function effectiveDate(entry) {
  return entry.client_created_at ?? entry.created_at
}

/**
 * Group history items (routine entries + stock consumptions) by day.
 * Returns a list of `{ dateLabel, items }` ready to render as sections.
 *
 * `dateLabel` is the localised long-form date ("Thursday, 23 April 2026")
 * — the single assertable header used across the app for day grouping.
 */
export function groupEntriesByDate(entries) {
  const map = new Map()
  for (const e of entries) {
    const label = new Date(effectiveDate(e)).toLocaleDateString(getLocale(), {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    if (!map.has(label)) map.set(label, [])
    map.get(label).push(e)
  }
  return Array.from(map.entries()).map(([dateLabel, items]) => ({
    dateLabel,
    items,
  }))
}

export function formatEntryTime(entry) {
  return new Date(effectiveDate(entry)).toLocaleTimeString(getLocale(), {
    hour: '2-digit',
    minute: '2-digit',
  })
}
