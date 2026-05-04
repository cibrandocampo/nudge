import { useTranslation } from 'react-i18next'
import cx from '../utils/cx'
import { formatEntryTime } from '../utils/historyGroups'
import Icon from './Icon'
import { useAuth } from '../contexts/AuthContext'
import shared from '../styles/shared.module.css'
import s from './HistoryEntryCard.module.css'

/**
 * Single day-grouped entry card used by HistoryPage and the detail pages'
 * "Recent activity" sections. One rendering, three consumers — keeps
 * routine-log and stock-consumption entries visually identical across
 * the app.
 *
 * Props:
 *   entry        — { _type: 'routine'|'consumption', created_at, notes, ... }
 *   showTitle    — when false, skips the routine/stock name row. The detail
 *                  pages use this because the page title already names the
 *                  resource.
 *   onStartEdit  — opens the notes editor. Omit (along with onSave) to
 *                  render the notes read-only.
 *   onCancelEdit / onSave / isEditing — notes-editor state
 *                  (HistoryPage wires these to its mutations; the
 *                  save-confirmation is surfaced via the toast system,
 *                  not inline).
 */
export default function HistoryEntryCard({
  entry,
  showTitle = true,
  compact = false,
  onStartEdit,
  onCancelEdit,
  onSave,
  isEditing,
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isRoutine = entry._type === 'routine'
  const title = isRoutine ? entry.routine_name : entry.stock_name
  const authorUsername = isRoutine ? entry.completed_by_username : entry.consumed_by_username
  const showAuthor = Boolean(authorUsername && authorUsername !== user?.username)
  const authorLabel = showAuthor
    ? isRoutine
      ? t('sharing.completedBy', { username: authorUsername })
      : t('sharing.consumedBy', { username: authorUsername })
    : null

  const totalQty = entry.consumed_lots?.reduce((sum, l) => sum + l.quantity, 0) ?? 0
  const lotNumbers = (entry.consumed_lots || [])
    .filter((l) => l.lot_number)
    .map((l) => l.lot_number)
    .join(', ')

  const editable = typeof onStartEdit === 'function' && typeof onSave === 'function'

  if (compact) {
    return (
      <div className={cx(shared.card, s.compactCard)} data-testid="history-entry" data-entry-type={entry._type}>
        <div className={s.compactRow}>
          <span className={s.compactLeft}>
            <span className={s.compactTime}>{formatEntryTime(entry)}</span>
            {lotNumbers && <span className={s.compactLot}>({lotNumbers})</span>}
            {entry.notes && <span className={s.compactNotes}>{entry.notes}</span>}
          </span>
          {!isRoutine && (
            <span className={s.compactRight}>
              <span className={s.compactQty}>−{entry.quantity}</span>
              {showAuthor && <span className={s.compactAuthor}>{authorLabel}</span>}
            </span>
          )}
          {isRoutine && showAuthor && (
            <span className={s.compactRight}>
              <span className={s.compactAuthor}>{authorLabel}</span>
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={cx(shared.card, s.entryCard)} data-testid="history-entry" data-entry-type={entry._type}>
      <div className={shared.cardHeader}>
        <div className={shared.cardMeta}>
          {showTitle && (
            <span className={cx(shared.cardTitle, shared.cardTitleFlex, s.entryName)}>
              <Icon name={isRoutine ? 'badge-check' : 'package'} size="sm" />
              <span>{title}</span>
            </span>
          )}
          {entry.consumed_lots?.length > 0 && (
            <span className={shared.cardStockBadge}>
              <Icon name="package" size="sm" />
              <span>
                {totalQty} × {entry.stock_name}
                {lotNumbers && <span className={s.consumedLot}> ({lotNumbers})</span>}
              </span>
            </span>
          )}
        </div>
        <div className={s.rightCol}>
          <span className={s.entryTime}>{formatEntryTime(entry)}</span>
          {showAuthor && <span className={s.entryAuthor}>{authorLabel}</span>}
          {(editable || entry.notes) && (
            <div className={s.notesSide}>
              {isEditing ? (
                <input
                  className={cx(shared.input, s.notesInput)}
                  autoFocus
                  defaultValue={entry.notes || ''}
                  placeholder={t('history.notesPlaceholder')}
                  onBlur={(ev) => onSave(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') onSave(ev.target.value)
                    if (ev.key === 'Escape') onCancelEdit()
                  }}
                />
              ) : (
                <>
                  {entry.notes &&
                    (editable ? (
                      <button type="button" className={cx(s.notesView, s.notesViewEditable)} onClick={onStartEdit}>
                        {entry.notes}
                      </button>
                    ) : (
                      <span className={s.notesView}>{entry.notes}</span>
                    ))}
                  {editable && (
                    <button
                      type="button"
                      className={shared.btnIcon}
                      onClick={onStartEdit}
                      aria-label={entry.notes ? t('history.editNotes') : t('history.addNote')}
                      title={entry.notes ? t('history.editNotes') : t('history.addNote')}
                    >
                      <Icon name="notebook-pen" size="sm" />
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
