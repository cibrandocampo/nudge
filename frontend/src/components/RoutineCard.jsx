import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatRelativeTime, formatAbsoluteDate } from '../utils/time'
import cx from '../utils/cx'
import shared from '../styles/shared.module.css'
import s from './RoutineCard.module.css'

function statusClass(routine) {
  if (!routine.is_due) return null
  if (routine.hours_until_due === null || routine.hours_until_due < -1) return s.borderDanger
  return s.borderWarning
}

export default function RoutineCard({ routine, onMarkDone, completing }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const timeLabel = routine.next_due_at
    ? formatRelativeTime(routine.next_due_at)
    : `${t('card.since')} ${formatAbsoluteDate(routine.created_at)}`

  const info = (
    <div className={s.info}>
      <span className={s.name}>{routine.name}</span>
      <span className={s.time}>{timeLabel}</span>
      {routine.stock_name && (
        <span className={s.stock}>
          {t('card.stock')} {routine.stock_quantity} · {routine.stock_name}
        </span>
      )}
    </div>
  )

  if (!routine.is_due) {
    return (
      <Link to={`/routines/${routine.id}`} className={cx(s.row, s.rowLink, s.borderSuccess)}>
        {info}
        <span className={s.chevron}>›</span>
      </Link>
    )
  }

  return (
    <div
      className={cx(s.row, s.rowLink, statusClass(routine))}
      onClick={() => navigate(`/routines/${routine.id}`)}
    >
      {info}
      <div className={s.actions}>
        <button
          className={cx(s.doneBtn, completing && shared.disabled)}
          onClick={(e) => { e.stopPropagation(); onMarkDone(routine.id) }}
          disabled={completing}
        >
          {completing ? '…' : t('card.done')}
        </button>
        <span className={s.chevron}>›</span>
      </div>
    </div>
  )
}
