import { useTranslation } from 'react-i18next'
import { useServerReachable } from '../hooks/useServerReachable'
import Icon from './Icon'
import s from './OfflineBanner.module.css'

/**
 * Persistent yellow bar shown at the top whenever the reachability module
 * reports `serverReachable === false`. Reassures the user that their
 * changes to routines and stocks are being queued and will sync once the
 * backend is reachable again. Settings-style changes are blocked offline
 * (see T060/T061) so the banner copy focuses on the operational data.
 */
export default function OfflineBanner() {
  const reachable = useServerReachable()
  const { t } = useTranslation()

  if (reachable) return null

  return (
    <div className={s.banner} role="status" data-testid="offline-banner">
      <Icon name="wifi-off" size="sm" />
      <span>{t('offline.banner')}</span>
    </div>
  )
}
