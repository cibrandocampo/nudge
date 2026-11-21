import { useTranslation } from 'react-i18next'
import { useServerReachable } from '../hooks/useServerReachable'
import { getLastReachableAt } from '../offline/reachability'
import { formatTimeAgo } from '../utils/time'
import Notice from './Notice'

/**
 * The offline notice, first in the notice slot (T155): shown whenever the
 * reachability module reports `serverReachable === false`. Reassures the user
 * that their changes to routines and stocks are being queued and will sync
 * once the backend is reachable again. Settings-style changes are blocked
 * offline (see T060/T061) so the copy focuses on the operational data.
 *
 * A second line surfaces the timestamp of the last successful API response
 * (T180) — useful when a detail page renders from cache so the user knows how
 * stale the snapshot is. Hidden when no successful response was ever observed
 * (cold-start offline).
 */
export default function OfflineBanner() {
  const reachable = useServerReachable()
  const { t } = useTranslation()

  if (reachable) return null

  const lastReachableAt = getLastReachableAt()
  const lastSyncLabel =
    lastReachableAt != null
      ? t('offline.lastSync', {
          relative: formatTimeAgo(lastReachableAt),
        })
      : null

  return (
    <Notice
      tone="warning"
      icon="wifi-off"
      role="status"
      testId="offline-banner"
      detail={lastSyncLabel && <span data-testid="offline-banner-last-sync">{lastSyncLabel}</span>}
    >
      {t('offline.banner')}
    </Notice>
  )
}
