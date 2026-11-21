import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { usePushStatus } from '../hooks/usePushStatus'
import { useQueueEntries } from '../hooks/useQueueEntries'
import { useServerReachable } from '../hooks/useServerReachable'
import { dismissInstall, isInstallDismissed } from '../utils/installDismissal'
import InstallBanner from './InstallBanner'
import Notice from './Notice'
import OfflineBanner from './OfflineBanner'
import s from './NoticeSlot.module.css'

/**
 * The one place for app-wide notices, under the header (T155, UX-009). Only
 * one shows at a time — before, the install banner, the offline banner and
 * «notifications are off» could stack — in this priority:
 *
 *   1. offline — nothing else matters while the server is unreachable;
 *   2. changes that could not be saved (sync errors in the offline queue);
 *      waiting changes are the header's PendingBadge's, not a notice. The
 *      notice opens that badge's panel;
 *   3. install — first because on iPhone notifications only work once
 *      installed; its × hides it for good on this device;
 *   4. notifications are off — leads to Settings.
 */
export default function NoticeSlot() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const reachable = useServerReachable()
  const entries = useQueueEntries()
  const { canInstall } = useInstallPrompt()
  const { active: pushActive } = usePushStatus()
  const [installDismissed, setInstallDismissed] = useState(isInstallDismissed)

  const syncErrors = entries.filter((entry) => entry.status === 'error').length

  let notice = null
  if (!reachable) {
    notice = <OfflineBanner />
  } else if (syncErrors > 0) {
    notice = (
      <Notice
        tone="danger"
        icon="alert-triangle"
        onClick={() => window.dispatchEvent(new Event('open-pending-badge'))}
        testId="notice-sync-errors"
      >
        {t('notice.syncErrors', { count: syncErrors })}
      </Notice>
    )
  } else if (canInstall && !installDismissed) {
    notice = (
      <InstallBanner
        onDismiss={() => {
          dismissInstall()
          setInstallDismissed(true)
        }}
      />
    )
  } else if (!pushActive) {
    notice = (
      <Notice tone="neutral" icon="info" onClick={() => navigate('/settings#push')} testId="notice-push-off">
        {t('settings.pushAlert')}
      </Notice>
    )
  }

  if (!notice) return null
  return <div className={s.slot}>{notice}</div>
}
