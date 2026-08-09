import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cx from '../utils/cx'
import { formatEntryTime } from '../utils/historyGroups'
import ConfirmModal from './ConfirmModal'
import Icon from './Icon'
import { useAuth } from '../contexts/AuthContext'
import { useClickOutside } from '../hooks/useClickOutside'
import { useEscapeKey } from '../hooks/useEscapeKey'
import buttons from '../styles/buttons.module.css'
import cards from '../styles/cards.module.css'
import forms from '../styles/forms.module.css'
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

  // The editor's value lives here rather than in the DOM: a save *button*
  // needs to read what was typed at click time, which an uncontrolled input
  // cannot offer without a ref, and the dirty check needs it on every change.
  const [draft, setDraft] = useState(entry.notes || '')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const editorRef = useRef(null)

  // Reset whenever the editor opens, so reopening after a discard starts from
  // what is stored rather than from the abandoned text.
  useEffect(() => {
    if (isEditing) setDraft(entry.notes || '')
  }, [isEditing, entry.notes])

  const isDirty = draft !== (entry.notes || '')

  /**
   * Leaving the editor. Only a changed draft is worth a prompt — asking after
   * an accidental open, with nothing typed, would be friction for no risk.
   */
  const requestClose = () => {
    if (isDirty) setConfirmDiscard(true)
    else onCancelEdit()
  }

  // Escape follows the same rule as clicking away on purpose: it is the easier
  // of the two to hit by accident, so protecting only the click would be
  // theatre. The ref wraps the input *and* the save button, so pressing save
  // never counts as clicking outside.
  useClickOutside(editorRef, requestClose, Boolean(isEditing) && !confirmDiscard)
  useEscapeKey(requestClose, Boolean(isEditing) && !confirmDiscard)

  const isRoutine = entry._type === 'routine'
  const title = isRoutine ? entry.routine_name : entry.stock_name
  const authorId = isRoutine ? entry.completed_by_id : entry.consumed_by_id
  const authorName = isRoutine ? entry.completed_by_display_name : entry.consumed_by_display_name
  // Show the chip only when the entry belongs to someone other than the
  // current user. Comparison is by id (stable internal identifier);
  // display is by `*_display_name` (post-T197 server field).
  const showAuthor = Boolean(authorId && user?.id && authorId !== user.id && authorName)
  // Tooltip / aria fallback in the active language. The chip itself shows
  // an icon + name instead of the localised "by …" prefix to keep the
  // metadata line short.
  const authorLabel = showAuthor
    ? isRoutine
      ? t('sharing.completedBy', { name: authorName })
      : t('sharing.consumedBy', { name: authorName })
    : null

  const totalQty = entry.consumed_lots?.reduce((sum, l) => sum + l.quantity, 0) ?? 0
  // Kept as pairs rather than flattened to a string: the compact and the full
  // card have very different space budgets and want different layouts.
  //
  // Both parts are optional. A lot may carry no serial, and snapshots written
  // before serials existed have **no `serial_number` key at all** — see
  // `Stock.consume_lots` in models.py. `|| null` collapses `undefined` and
  // `null` to the same thing, which is exactly the intent.
  const consumedLots = (entry.consumed_lots || [])
    .map((l) => ({ lotNumber: l.lot_number || null, serialNumber: l.serial_number || null }))
    .filter((l) => l.lotNumber || l.serialNumber)

  // `LOT` and `SN` are deliberately NOT translated: they are the abbreviations
  // GS1 prints on the box itself, so keeping them fixed matches the pack the
  // user is holding. Only the full labels in the expanded card are localised.
  const compactLots = consumedLots
    .map(({ lotNumber, serialNumber }) =>
      [lotNumber && `LOT ${lotNumber}`, serialNumber && `SN ${serialNumber}`].filter(Boolean).join(' · '),
    )
    .join(', ')

  // True when the card's own title is already the stock's name, which is the
  // case for a consumption entry with its title shown.
  const namedInTitle = showTitle && !isRoutine

  const editable = typeof onStartEdit === 'function' && typeof onSave === 'function'

  if (compact) {
    return (
      <div className={cx(cards.card, s.compactCard)} data-testid="history-entry" data-entry-type={entry._type}>
        <div className={s.compactRow}>
          <span className={s.compactLeft}>
            <span className={s.compactTime}>{formatEntryTime(entry)}</span>
            {compactLots && <span className={s.compactLot}>({compactLots})</span>}
            {entry.notes && <span className={s.compactNotes}>{entry.notes}</span>}
          </span>
          {!isRoutine && (
            <span className={s.compactRight}>
              <span className={s.compactQty}>−{entry.quantity}</span>
              {showAuthor && (
                <span className={s.compactAuthor} aria-label={authorLabel} title={authorLabel}>
                  <Icon name="users" size="sm" />
                  <span>{authorName}</span>
                </span>
              )}
            </span>
          )}
          {isRoutine && showAuthor && (
            <span className={s.compactRight}>
              <span className={s.compactAuthor} aria-label={authorLabel} title={authorLabel}>
                <Icon name="users" size="sm" />
                <span>{authorName}</span>
              </span>
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={cx(cards.card, s.entryCard)} data-testid="history-entry" data-entry-type={entry._type}>
      {/* Header row: identity (left) + metadata + edit affordance (right).
          Always the same height regardless of notes — keeps the list rhythm
          consistent. Long notes flow into the dedicated full-width row below. */}
      <div className={cx(cards.cardHeader, s.entryHeader)}>
        <div className={cards.cardMeta}>
          {showTitle && (
            <span className={cx(cards.cardTitle, cards.cardTitleFlex, s.entryName)}>
              <Icon name={isRoutine ? 'badge-check' : 'package'} size="sm" />
              <span>{title}</span>
            </span>
          )}
          {entry.consumed_lots?.length > 0 && (
            <span className={cx(cards.cardStockBadge, s.entryStockBadge)} data-testid="entry-stock-badge">
              <Icon name="package" size="sm" />
              {/* The stock name is dropped when the title already carries it —
                  a consumption is titled by its stock, so naming it twice says
                  nothing. A routine is titled by the routine, so the stock it
                  consumed is genuinely new information and stays. Keyed off
                  `showTitle` rather than the entry type: hide the title and the
                  name becomes useful again.

                  The value half carries `badgeValue` so it reads at the same
                  weight as a lot number or a serial below it. */}
              <span>
                {namedInTitle ? (
                  <span className={s.badgeValue}>
                    {totalQty} {t('common.unit')}
                  </span>
                ) : (
                  <>
                    {totalQty} × <span className={s.badgeValue}>{entry.stock_name}</span>
                  </>
                )}
              </span>
            </span>
          )}
          {/* One block per consumed lot, label and value on their own lines.
              Deliberately literal to the snapshot: two boxes of the same batch
              produce two blocks rather than being grouped. */}
          {consumedLots.length > 0 && (
            <dl className={s.lotList}>
              {consumedLots.map(({ lotNumber, serialNumber }, idx) => (
                <div key={idx} className={s.lotBlock}>
                  {lotNumber && (
                    <>
                      {/* A tag is what a whole batch wears; a badge identifies
                          one individual pack. The icon column also lines these
                          rows up with the stock badge above, which has one. */}
                      <dt className={s.lotLabel}>
                        <Icon name="tag" size="sm" />
                        <span>{t('inventory.lotNumber')}</span>
                      </dt>
                      <dd className={s.lotValue}>{lotNumber}</dd>
                    </>
                  )}
                  {serialNumber && (
                    <>
                      <dt className={s.lotLabel}>
                        <Icon name="badge" size="sm" />
                        <span>{t('inventory.lotSerial')}</span>
                      </dt>
                      <dd className={s.lotValue}>{serialNumber}</dd>
                    </>
                  )}
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className={s.rightCol}>
          <div className={s.metaLine}>
            {showAuthor && (
              <span className={s.entryAuthor} aria-label={authorLabel} title={authorLabel}>
                <Icon name="users" size="sm" />
                <span>{authorName}</span>
              </span>
            )}
            <span className={s.entryTime}>{formatEntryTime(entry)}</span>
          </div>
          {/* Only the *add* affordance lives up here. Once a note exists the
              pencil moves down beside it — see the notes row — so there is
              exactly one edit control on screen, and it sits next to the thing
              it acts on. */}
          {editable && !entry.notes && (
            <button
              type="button"
              className={buttons.btnIcon}
              onClick={onStartEdit}
              aria-label={t('history.addNote')}
              title={t('history.addNote')}
              data-testid="add-note"
            >
              <Icon name="notebook-pen" size="sm" />
            </button>
          )}
        </div>
      </div>
      {/* Notes row spans the full width so wrapped paragraphs use the
          horizontal space efficiently. Hidden when there's nothing to show
          and we're not actively editing. */}
      {(isEditing || entry.notes) && (
        <div className={s.notesRow}>
          {isEditing ? (
            // The ref covers the input *and* the save button: clicking save
            // must not read as clicking away, or saving would prompt to
            // discard. Note there is no `onBlur` — a form with no visible
            // buttons discards on click-away by every convention, so saving
            // there did the opposite of what the interface promised.
            <div className={s.notesEditor} ref={editorRef}>
              <input
                className={cx(forms.input, s.notesInput)}
                autoFocus
                value={draft}
                onChange={(ev) => setDraft(ev.target.value)}
                placeholder={t('history.notesPlaceholder')}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') onSave(draft)
                }}
                data-testid="note-input"
              />
              <button
                type="button"
                className={cx(buttons.btnIcon, s.notesEdit)}
                onClick={() => onSave(draft)}
                aria-label={t('common.save')}
                title={t('common.save')}
                data-testid="save-note"
              >
                <Icon name="check" size="sm" />
              </button>
            </div>
          ) : (
            <>
              {/* Plain text, never a hidden button. Creating and editing both
                  go through a visible control, so the note keeps no click
                  target of its own — and loses the padding that used to exist
                  only to make it tappable. */}
              <Icon name="notebook-pen" size="sm" className={s.notesIcon} />
              <span className={s.notesView}>{entry.notes}</span>
              {editable && (
                <button
                  type="button"
                  className={cx(buttons.btnIcon, s.notesEdit)}
                  onClick={onStartEdit}
                  aria-label={t('history.editNotes')}
                  title={t('history.editNotes')}
                  data-testid="edit-note"
                >
                  <Icon name="pencil" size="sm" />
                </button>
              )}
            </>
          )}
        </div>
      )}
      {/* Rendered from the card, not the page: the draft lives here, so this is
          the only component that knows whether anything would be lost. */}
      {confirmDiscard && (
        <ConfirmModal
          message={t('history.discardNoteConfirm')}
          confirmLabel={t('history.discardNote')}
          onConfirm={() => {
            setConfirmDiscard(false)
            onCancelEdit()
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </div>
  )
}
