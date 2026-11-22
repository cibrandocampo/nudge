import cx from '../utils/cx'
import Icon from './Icon'
import s from './Notice.module.css'

/**
 * One notice of the slot under the header (T155, UX-009): offline, changes
 * that could not be saved, install, notifications off. `NoticeSlot` decides
 * which one shows; this only draws it.
 *
 * Tones use the state containers (T145) instead of the full logo yellow, which
 * made a notice the loudest thing on screen: `warning` (amber container),
 * `danger` (red container), `neutral` (a quiet surface, for invitations).
 * The icon carries the state too, never the colour alone. 44 px tall at least,
 * like every target.
 *
 * Props:
 *   tone      — 'warning' | 'danger' | 'neutral' | 'action' (navy tile, for
 *               what reminders depend on)
 *   icon      — sprite name, before the text
 *   onClick   — makes the message a button (with a chevron)
 *   role      — e.g. 'status' for the offline notice
 *   detail    — an optional second, smaller line
 *   cta       — visible action label on the button, instead of the chevron
 *   testId (the notice), actionTestId (its button, when `onClick`)
 */
export default function Notice({ tone = 'neutral', icon, onClick, role, detail, cta, testId, actionTestId, children }) {
  const body = (
    <>
      {icon && <Icon name={icon} size="sm" className={s.icon} />}
      <span className={s.text}>
        <span>{children}</span>
        {detail && <span className={s.detail}>{detail}</span>}
      </span>
    </>
  )
  return (
    <div className={cx(s.notice, s[tone])} role={role} data-testid={testId}>
      {onClick ? (
        <button type="button" className={s.main} onClick={onClick} data-testid={actionTestId}>
          {body}
          {cta ? <span className={s.cta}>{cta}</span> : <Icon name="chevron-right" size="sm" className={s.icon} />}
        </button>
      ) : (
        <div className={s.main}>{body}</div>
      )}
    </div>
  )
}
