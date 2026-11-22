import { Link } from 'react-router-dom'
import buttons from '../styles/buttons.module.css'
import cx from '../utils/cx'
import s from './EmptyCard.module.css'

/**
 * Friendly empty-state card. Used when a list section has no items —
 * both the "all done today" positive note on the dashboard and the
 * "no items yet" suggestion on the inventory share this look.
 *
 * Props:
 *   title     — short bold header
 *   message   — secondary line under the title
 *   action    — optional button below the message (T156, UX-035):
 *               `{ label, to }` for a destination or `{ label, onClick }` for
 *               a page action. `secondary` draws it as a secondary button
 *               (undoing a filter is not the page's main action);
 *               `unavailable` marks it `aria-disabled` while its `onClick`
 *               explains why (offline).
 */
export default function EmptyCard({ title, message, action }) {
  const actionClass = cx(
    buttons.btn,
    action?.secondary ? buttons.secondary : buttons.primary,
    action?.unavailable && buttons.disabled,
    s.action,
  )
  return (
    <div className={s.card} data-testid="empty-card">
      {title && <p className={s.title}>{title}</p>}
      {message && <p className={s.body}>{message}</p>}
      {action?.onClick && (
        <button
          type="button"
          className={actionClass}
          onClick={action.onClick}
          aria-disabled={action.unavailable || undefined}
        >
          {action.label}
        </button>
      )}
      {action?.to && (
        <Link to={action.to} className={actionClass}>
          {action.label}
        </Link>
      )}
    </div>
  )
}
