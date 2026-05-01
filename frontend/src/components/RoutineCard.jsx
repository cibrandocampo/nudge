import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { formatRelativeTime, formatAbsoluteDate } from '../utils/time'
import cx from '../utils/cx'
import { findCachedStock } from '../utils/lotsForSelection'
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

function stockIconClass(severity) {
  if (severity === 'out') return shared.iconDanger
  if (severity === 'low') return shared.iconWarning
  if (severity === 'ok') return shared.iconSuccess
  return null
}

export default function RoutineCard({ routine, onMarkDone, completing }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const timeLabel = routine.next_due_at
    ? formatRelativeTime(routine.next_due_at)
    : `${t('card.since')} ${formatAbsoluteDate(routine.created_at)}`

  const resourceKey = `routine:${routine.id}`
  const tokens = statusTokens(routine)
  const cachedStock = findCachedStock(queryClient, routine.stock)
  const iconCls = stockIconClass(cachedStock?.stock_severity)

  // Passive badge only — sharing is edited from the routine form
  // (ShareWithSection → ShareModal). Mirrors the pattern used on StockCard.
  // Owner sees the filled variant; recipient sees the outlined one. Both
  // use the same icon so the visual language is consistent.
  const isShared = routine.shared_with?.length > 0 || routine.is_owner === false
  const isOwnerOfShare = routine.is_owner !== false
  const sharedBadgeAria = isOwnerOfShare
    ? t('sharing.sharedBadgeOwnerAria')
    : t('sharing.sharedBadgeRecipientAria', { owner: routine.owner_username ?? '' })
  const sharedBadge = isShared && (
    <span
      className={cx(shared.btnIcon, isOwnerOfShare ? shared.btnIconShared : shared.btnIconSharedRecipient)}
      aria-label={sharedBadgeAria}
      title={sharedBadgeAria}
      data-testid="shared-badge"
      data-variant={isOwnerOfShare ? 'owner' : 'recipient'}
    >
      <Icon name="users" size="sm" />
    </span>
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
            <Icon name="package" size="sm" className={iconCls} data-testid="stock-icon" />
            {routine.stock_usage ?? 1} × {routine.stock_name}
          </span>
        )}
      </div>
      <div className={shared.cardActions}>
        {sharedBadge}
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
