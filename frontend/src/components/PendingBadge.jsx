import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useClickOutside } from '../hooks/useClickOutside'
import { useQueueEntries } from '../hooks/useQueueEntries'
import { discard } from '../offline/queue'
import { forceSync } from '../offline/sync'
import { formatShortDate } from '../utils/time'
import Icon from './Icon'
import s from './PendingBadge.module.css'

const STATUS_ICON = {
  pending: 'clock',
  syncing: 'upload-cloud',
  error: 'alert-triangle',
  conflict: 'git-merge',
}

/**
 * In-header chip that surfaces how many offline mutations are waiting to
 * sync. Click opens a dropdown listing each entry with its status, origin
 * endpoint and a discard button so the user can get rid of stuck writes
 * manually. Conflicts are left to ConflictOrchestrator + ConflictModal.
 */
export default function PendingBadge() {
  const entries = useQueueEntries()
  const qc = useQueryClient()
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)

  useClickOutside(wrapperRef, () => setOpen(false), open)

  // Sync-errors toast (T065) dispatches this event so the user can jump to
  // the pending panel without hunting for the badge.
  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('open-pending-badge', handler)
    return () => window.removeEventListener('open-pending-badge', handler)
  }, [])

  if (entries.length === 0) return null

  const outstanding = entries.filter((e) => e.status === 'pending' || e.status === 'syncing')
  const count = outstanding.length
  const hasErrors = entries.some((e) => e.status === 'error')
  // Dominant badge state — used by E2E tests via `data-state`. "error" wins
  // over "syncing" so the user notices failures first; otherwise the badge
  // reflects whether anything is currently in flight.
  const dominantState = hasErrors ? 'error' : outstanding.some((e) => e.status === 'syncing') ? 'syncing' : 'pending'

  return (
    <div className={s.wrapper} ref={wrapperRef}>
      <button
        type="button"
        className={s.badge}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('offline.pending', { count })}
        data-testid="pending-badge"
        data-count={count}
        data-state={dominantState}
      >
        {count > 0 ? count : '!'}
      </button>
      {open && (
        <div className={s.panel} role="dialog" aria-label={t('offline.panel.title')}>
          <div className={s.panelHeader}>
            <span className={s.panelTitle}>{t('offline.panel.title')}</span>
            <button type="button" className={s.close} onClick={() => setOpen(false)} aria-label={t('common.close')}>
              <Icon name="x" size="sm" />
            </button>
          </div>
          <ul className={s.list}>
            {entries.map((entry) => (
              <li key={entry.id} className={s.item} data-testid={`pending-item-${entry.status}`}>
                <span className={`${s.statusIcon} ${s[`status_${entry.status}`]}`}>
                  <Icon name={STATUS_ICON[entry.status]} size="sm" />
                </span>
                <div className={s.itemBody}>
                  <div className={s.itemTitle}>
                    {entry.labelKey ? t(entry.labelKey, entry.labelArgs ?? {}) : `${entry.method} ${entry.endpoint}`}
                  </div>
                  <div className={s.itemMeta}>
                    {t(`offline.status.${entry.status}`)} · {formatShortDate(entry.createdAt)}
                  </div>
                </div>
                <button
                  type="button"
                  className={s.discard}
                  onClick={() => discard(entry.id, qc)}
                  aria-label={t('offline.panel.discard')}
                >
                  {t('offline.panel.discard')}
                </button>
              </li>
            ))}
          </ul>
          {hasErrors && (
            <div className={s.footer}>
              <button type="button" className={s.retry} onClick={() => forceSync()}>
                {t('offline.panel.retryAll')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
