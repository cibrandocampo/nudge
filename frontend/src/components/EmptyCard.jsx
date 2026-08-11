import { Link } from 'react-router-dom'
import s from './EmptyCard.module.css'

/**
 * Friendly empty-state card. Used when a list section has no items —
 * both the "all done today" positive note on the dashboard and the
 * "no items yet" suggestion on the inventory share this look.
 *
 * Props:
 *   title     — short bold header
 *   message   — secondary line under the title
 *   action    — optional call to action below the message, either
 *               `{ label, to }` for a link or `{ label, onClick }` for a
 *               button. A filtered-empty list needs to undo the filter, which
 *               is a page action and not a destination.
 */
export default function EmptyCard({ title, message, action }) {
  return (
    <div className={s.card}>
      {title && <p className={s.title}>{title}</p>}
      {message && <p className={s.body}>{message}</p>}
      {action?.onClick && (
        <button type="button" className={s.link} onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {action?.to && (
        <Link to={action.to} className={s.link}>
          {action.label}
        </Link>
      )}
    </div>
  )
}
