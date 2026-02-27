import { Link } from 'react-router-dom'
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
  const timeLabel = routine.next_due_at
    ? formatRelativeTime(routine.next_due_at)
    : `${t('card.since')} ${formatAbsoluteDate(routine.created_at)}`

  return (
    <div className={cx(s.row, statusClass(routine))}>
      <div className={s.info}>
        <Link to={`/routines/${routine.id}`} className={s.name}>
          {routine.name}
        </Link>
        <span className={s.time}>{timeLabel}</span>
        {routine.stock_name && (
          <span className={s.stock}>
            {t('card.stock')} {routine.stock_quantity} · {routine.stock_name}
          </span>
        )}
      </div>
      {routine.is_due && (
        <button
          className={cx(s.doneBtn, completing && shared.disabled)}
          onClick={() => onMarkDone(routine.id)}
          disabled={completing}
        >
          {completing ? '…' : t('card.done')}
        </button>
      )}
    </div>
  )
}
