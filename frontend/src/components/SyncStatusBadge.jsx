import { useTranslation } from 'react-i18next'
import { useQueueEntries } from '../hooks/useQueueEntries'
import Icon from './Icon'
import s from './SyncStatusBadge.module.css'

// Which status wins when multiple entries exist for the same resource.
// Conflict is the most attention-demanding → first. Error next (user may
// need to discard). Syncing > pending because if an entry is mid-flight,
// that's the most current state.
const PRIORITY = ['conflict', 'error', 'syncing', 'pending']

const ICON_FOR = {
  pending: 'clock',
  syncing: 'upload-cloud',
  error: 'alert-triangle',
  conflict: 'git-merge',
}

/**
 * Inline status dot for a specific resource (e.g. `routine:5`). Reads from
 * the offline queue and renders nothing when the resource has no pending
 * local changes.
 */
export default function SyncStatusBadge({ resourceKey, className = '' }) {
  const entries = useQueueEntries()
  const { t } = useTranslation()

  const relevant = entries.filter((e) => e.resourceKey === resourceKey)
  if (relevant.length === 0) return null

  const dominant = PRIORITY.find((status) => relevant.some((e) => e.status === status))
  if (!dominant) return null

  const label = t(`offline.status.${dominant}`)
  const classes = [s.badge, s[dominant], className].filter(Boolean).join(' ')

  return (
    <span
      className={classes}
      role="status"
      aria-label={label}
      title={label}
      data-testid="sync-status-badge"
      data-state={dominant}
    >
      <Icon name={ICON_FOR[dominant]} size="sm" />
    </span>
  )
}
