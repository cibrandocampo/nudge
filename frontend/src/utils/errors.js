import { OfflineError } from '../api/errors'

// Map of backend `body.code` values to i18n keys. Add an entry here
// (plus the 3-language string) whenever a viewset starts returning a new
// `code` literal so the UI surfaces a translated, contextual message
// instead of the generic fallback. Codes without an entry fall through
// to `body.detail` (always English) → fallbackKey.
const ERROR_CODE_I18N_KEYS = {
  insufficient_stock: 'errors.insufficientStock',
}

/**
 * Returns a translated, user-facing message for an error caught from a
 * mutation/fetch. Resolution order:
 *
 *   1. ``OfflineError`` → ``offline.actionUnavailable``.
 *   2. ``err.body.code`` matches an entry in ``ERROR_CODE_I18N_KEYS`` →
 *      translated message with ``err.body`` passed as i18n args (so the
 *      string can interpolate fields like ``required`` / ``available``).
 *   3. ``err.body.detail`` (a human string the backend already crafted) →
 *      shown verbatim. English-only; consumers wanting localisation must
 *      add the code to ``ERROR_CODE_I18N_KEYS``.
 *   4. ``fallbackKey`` (default ``common.actionError``) — generic.
 */
export function errorToastMessage(err, t, fallbackKey = 'common.actionError') {
  if (err instanceof OfflineError) return t('offline.actionUnavailable')
  const body = err?.body
  if (body && typeof body === 'object') {
    const key = ERROR_CODE_I18N_KEYS[body.code]
    if (key) return t(key, body)
    if (typeof body.detail === 'string' && body.detail.length > 0) return body.detail
  }
  return t(fallbackKey)
}
