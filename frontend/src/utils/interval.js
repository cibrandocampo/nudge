// Shared conversions between human `{ value, unit }` and the backend's
// `interval_hours` integer. Pure module — no React, no i18n. Designed to
// feed IntervalPicker and any future consumer that needs to express a
// recurrence in human units.

export const UNIT_KEYS = ['hours', 'days', 'weeks', 'months', 'years']

export const UNIT_FACTORS = {
  hours: 1,
  days: 24,
  weeks: 168,
  months: 720,
  years: 8760,
}

// Maximum value per unit so the total interval caps at 2 years
// (decision closed in docs/plans/interval-picker-redesign.md).
export const UNIT_MAX_VALUES = {
  hours: 17520,
  days: 730,
  weeks: 104,
  months: 24,
  years: 2,
}

export function toHours(value, unit) {
  const factor = UNIT_FACTORS[unit]
  if (factor == null) return 0
  return Number(value) * factor
}

// Picks the largest unit that divides `hours` exactly. Mirrors the
// behaviour of the old inline helper so existing interval_hours values
// map to the same human tuple after the refactor.
export function hoursToHuman(hours) {
  const h = Number(hours)
  const reversed = [...UNIT_KEYS].reverse()
  for (const key of reversed) {
    const factor = UNIT_FACTORS[key]
    if (h >= factor && h % factor === 0) return { value: h / factor, unit: key }
  }
  return { value: h, unit: 'hours' }
}

export function clampValue(value, unit) {
  const max = UNIT_MAX_VALUES[unit] ?? UNIT_MAX_VALUES.hours
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.min(Math.max(n, 1), max)
}
