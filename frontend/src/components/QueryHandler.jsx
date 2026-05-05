import { useTranslation } from 'react-i18next'
import shared from '../styles/shared.module.css'
import Spinner from './Spinner'

/**
 * Wraps the common `isLoading / isError / !data` guard pattern from
 * detail and form pages. Returns:
 *   - <Spinner /> when isLoading.
 *   - notFoundKey-translated message when isError && error.status===404
 *     (the resource is definitively gone — show even if `data` is still
 *     present in cache from a previous fetch).
 *   - children (degraded mode) when isError but `data` is still
 *     available — TanStack Query keeps the last successful payload in
 *     cache (rehydrated from IndexedDB). The global OfflineBanner
 *     conveys the staleness; rendering data is preferable to a wall of
 *     error text the user can't act on.
 *   - errorKey-translated message when isError and there is no `data`.
 *   - notFoundKey message when notFound is true (no error, no data).
 *   - children when the query has resolved successfully.
 */
export default function QueryHandler({
  isLoading,
  isError,
  error,
  data,
  notFound = false,
  notFoundKey,
  errorKey = 'common.error',
  children,
}) {
  const { t } = useTranslation()
  if (isLoading) return <Spinner />
  if (isError && error?.status === 404 && notFoundKey) {
    return <p className={shared.muted}>{t(notFoundKey)}</p>
  }
  if (isError && data !== undefined && data !== null) {
    return children
  }
  if (isError) return <p className={shared.muted}>{t(errorKey)}</p>
  if (notFound && notFoundKey) {
    return <p className={shared.muted}>{t(notFoundKey)}</p>
  }
  return children
}
