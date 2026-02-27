import i18next from 'i18next'

const LOCALE_MAP = { en: 'en-GB', es: 'es-ES', gl: 'gl-ES' }

export function getLocale() {
  return LOCALE_MAP[i18next.language] ?? i18next.language
}

/**
 * Formats a UTC ISO datetime string as a short absolute local date+time.
 * e.g. "25 Feb, 14:30" or "3 Jan 2025, 09:00" (year shown if different from current)
 */
export function formatAbsoluteDate(isoString) {
  if (!isoString) return '—'
  const d = new Date(isoString)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString(getLocale(), {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Formats a UTC ISO datetime string as a human-readable relative label.
 * The browser's local timezone is used automatically via the Date API.
 */
export function formatRelativeTime(isoString) {
  if (!isoString) return i18next.t('time.neverLogged')
  const diffHours = (new Date(isoString) - new Date()) / 3_600_000

  if (diffHours < -1) return i18next.t('time.overdueBy', { n: Math.round(Math.abs(diffHours)) })
  if (diffHours < 0) return i18next.t('time.dueNow')
  if (diffHours < 1) return i18next.t('time.inMin', { n: Math.round(diffHours * 60) })
  if (diffHours < 24) return i18next.t('time.inHours', { n: Math.round(diffHours) })
  const days = Math.round(diffHours / 24)
  return days === 1 ? i18next.t('time.inDay') : i18next.t('time.inDays', { n: days })
}
