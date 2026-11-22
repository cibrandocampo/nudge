import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePendingActions } from '../hooks/usePendingActions'
import { useQueueEntries } from '../hooks/useQueueEntries'
import { useServerReachable } from '../hooks/useServerReachable'
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
 *   3. actions pending for reminders to work (install, notifications): it
 *      cannot be closed and leads to Settings, which lists them with what is
 *      at risk. Not shown on Settings itself, where the list already is.
 */
export default function NoticeSlot() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const reachable = useServerReachable()
  const entries = useQueueEntries()
  const { pathname } = useLocation()
  const { count: pendingActions } = usePendingActions()

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
  } else if (pendingActions > 0 && !pathname.startsWith('/settings')) {
    notice = (
      <Notice
        tone="action"
        icon="alert-triangle"
        cta={t('notice.pendingCta')}
        onClick={() => navigate('/settings#pending')}
        testId="notice-pending"
        actionTestId="notice-pending-action"
      >
        {t('notice.pendingActions', { count: pendingActions })}
      </Notice>
    )
  }

  if (!notice) return null
  return <div className={s.slot}>{notice}</div>
}
