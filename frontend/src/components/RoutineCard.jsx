import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatRelativeTime, formatAbsoluteDate } from '../utils/time'
import cx from '../utils/cx'
import Icon from './Icon'
import SyncStatusBadge from './SyncStatusBadge'
import shared from '../styles/shared.module.css'
import s from './RoutineCard.module.css'

function statusTokens(routine) {
  if (!routine.is_due) {
    return { border: shared.cardBorderSuccess, dot: shared.dotSuccess, text: shared.statusOk }
  }
  if (routine.is_overdue) {
    return { border: shared.cardBorderDanger, dot: shared.dotDanger, text: shared.statusOverdue }
  }
  return { border: shared.cardBorderWarning, dot: shared.dotWarning, text: shared.statusDue }
}

export default function RoutineCard({ routine, onMarkDone, completing, contacts, onShare }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const timeLabel = routine.next_due_at
    ? formatRelativeTime(routine.next_due_at)
    : `${t('card.since')} ${formatAbsoluteDate(routine.created_at)}`

  const resourceKey = `routine:${routine.id}`
  const tokens = statusTokens(routine)

  const canShare = routine.is_owner !== false && contacts?.length > 0
  const alreadyShared = routine.shared_with?.length > 0

  const shareButton = canShare && (
    <button
      type="button"
      className={cx(shared.btnIcon, alreadyShared ? shared.btnIconShared : shared.btnIconShare)}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onShare && onShare(routine.id)
      }}
      aria-label={t('card.share', 'Share')}
    >
      <Icon name="users" size="sm" />
    </button>
  )

  // Block completion when the routine consumes a stock with no inventory
  // — pain_relief (ibuprofen 0u) is the canonical seed case. Keeping the
  // button visible (just disabled) lets the user see the reason via the
  // tooltip instead of silently hiding the affordance.
  const stockDepleted =
    Boolean(routine.stock_name) && Number(routine.stock_quantity ?? 0) < Number(routine.stock_usage ?? 1)
  const doneDisabled = completing || stockDepleted
  const doneTitle = stockDepleted ? t('card.noStockAvailable') : undefined

  const doneButton = routine.is_due && (
    <button
      type="button"
      className={cx(shared.btnIcon, shared.btnIconDone, doneDisabled && shared.disabled)}
      onClick={(e) => {
        e.stopPropagation()
        onMarkDone(routine.id)
      }}
      disabled={doneDisabled}
      aria-label={t('card.done')}
      title={doneTitle}
    >
      {completing ? '…' : <Icon name="check" size="sm" />}
    </button>
  )

  const chevronButton = (
    <span className={cx(shared.btnIcon, shared.btnIconAction)} aria-hidden="true">
      <Icon name="chevron-right" size="sm" />
    </span>
  )

  const body = (
    <div className={shared.cardHeader}>
      <div className={shared.cardMeta}>
        <span className={cx(shared.cardTitle, shared.cardTitleFlex)}>
          <span>{routine.name}</span>
          <SyncStatusBadge resourceKey={resourceKey} className={s.syncBadge} />
        </span>
        <span className={shared.cardSubtitle}>
          <span className={cx(shared.status, tokens.text)}>
            <span className={cx(shared.dot, tokens.dot)} />
            {timeLabel}
          </span>
          {routine.interval_label && <span>{routine.interval_label}</span>}
        </span>
        {routine.stock_name && (
          <span className={shared.cardStockBadge}>
            <Icon name="package" size="sm" />
            {routine.stock_quantity} · {routine.stock_name}
          </span>
        )}
        {routine.is_owner === false && routine.owner_username && (
          <span className={s.ownerLabel}>{routine.owner_username}</span>
        )}
      </div>
      <div className={shared.cardActions}>
        {shareButton}
        {doneButton}
        {chevronButton}
      </div>
    </div>
  )

  const cardClass = cx(shared.card, shared.cardClickable, tokens.border)

  if (!routine.is_due) {
    return (
      <Link to={`/routines/${routine.id}`} className={cx(cardClass, s.cardLink)} data-testid="routine-card">
        {body}
      </Link>
    )
  }

  return (
    <div className={cardClass} onClick={() => navigate(`/routines/${routine.id}`)} data-testid="routine-card">
      {body}
    </div>
  )
}
