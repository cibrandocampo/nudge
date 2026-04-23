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
 *   action    — optional `{ label, to }` link rendered below the message
 */
export default function EmptyCard({ title, message, action }) {
  return (
    <div className={s.card}>
      {title && <p className={s.title}>{title}</p>}
      {message && <p className={s.body}>{message}</p>}
      {action && (
        <Link to={action.to} className={s.link}>
          {action.label}
        </Link>
      )}
    </div>
  )
}
