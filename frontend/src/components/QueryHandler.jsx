import { useTranslation } from 'react-i18next'
import shared from '../styles/shared.module.css'
import Spinner from './Spinner'

/**
 * Wraps the common `isLoading / isError / !data` guard pattern from
 * detail and form pages. Returns:
 *   - <Spinner /> when isLoading.
 *   - notFoundKey-translated message when isError && error.status===404
 *     OR notFound===true.
 *   - errorKey-translated message when isError (any other error).
 *   - children when query has resolved successfully.
 */
export default function QueryHandler({
  isLoading,
  isError,
  error,
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
  if (isError) return <p className={shared.muted}>{t(errorKey)}</p>
  if (notFound && notFoundKey) {
    return <p className={shared.muted}>{t(notFoundKey)}</p>
  }
  return children
}
