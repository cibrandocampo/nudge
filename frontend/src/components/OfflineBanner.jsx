import { useTranslation } from 'react-i18next'
import { useServerReachable } from '../hooks/useServerReachable'
import { getLastReachableAt } from '../offline/reachability'
import { formatRelativeTime } from '../utils/time'
import Icon from './Icon'
import s from './OfflineBanner.module.css'

/**
 * Persistent yellow bar shown at the top whenever the reachability module
 * reports `serverReachable === false`. Reassures the user that their
 * changes to routines and stocks are being queued and will sync once the
 * backend is reachable again. Settings-style changes are blocked offline
 * (see T060/T061) so the banner copy focuses on the operational data.
 *
 * A muted second line surfaces the timestamp of the last successful API
 * response (T180) — useful when a detail page renders from cache so the
 * user knows how stale the snapshot is. Hidden when no successful
 * response was ever observed (cold-start offline).
 */
export default function OfflineBanner() {
  const reachable = useServerReachable()
  const { t } = useTranslation()

  if (reachable) return null

  const lastReachableAt = getLastReachableAt()
  const lastSyncLabel =
    lastReachableAt != null
      ? t('offline.lastSync', {
          relative: formatRelativeTime(new Date(lastReachableAt).toISOString()),
        })
      : null

  return (
    <div className={s.banner} role="status" data-testid="offline-banner">
      <div className={s.row}>
        <Icon name="wifi-off" size="sm" />
        <span>{t('offline.banner')}</span>
      </div>
      {lastSyncLabel && (
        <p className={s.lastSync} data-testid="offline-banner-last-sync">
          {lastSyncLabel}
        </p>
      )}
    </div>
  )
}
