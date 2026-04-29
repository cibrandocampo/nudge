import { OfflineError } from '../api/errors'

/**
 * Returns a translated, user-facing message for an error caught from a
 * mutation/fetch. Use it inside `showToast({ message })` calls to keep
 * the OfflineError → "actionUnavailable" branch consistent.
 *
 * For errors that carry a server-provided `body.detail`, prefer inline
 * handling — this util only covers the offline vs generic fallback.
 */
export function errorToastMessage(err, t, fallbackKey = 'common.actionError') {
  if (err instanceof OfflineError) return t('offline.actionUnavailable')
  return t(fallbackKey)
}
