import { useState } from 'react'
import cx from '../utils/cx'
import Icon from './Icon'
import s from './IconChip.module.css'

/**
 * A chip that shows only its icon and unfolds its text on demand: a tap
 * toggles it (touch has no hover), a pointer hovering it unfolds it on a
 * computer, and so does keyboard focus.
 *
 * The text is always in the DOM, only folded out of sight, so it is the
 * button's accessible name and screen readers read it without unfolding.
 * `className` carries the tone (border and colour) from the caller.
 */
export default function IconChip({ icon, label, className, ...rest }) {
  const [open, setOpen] = useState(false)
  return (
    <button
      type="button"
      className={cx(s.chip, open && s.open, className)}
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
      {...rest}
    >
      <Icon name={icon} size="sm" />
      <span className={s.label}>{label}</span>
    </button>
  )
}
