import cx from '../utils/cx'
import s from './FormActions.module.css'

/**
 * The action row of every form and modal: write the children in visual order,
 * secondary first and primary last, so the Tab order matches what is on screen.
 * When they do not fit side by side they stack, with the primary at the bottom.
 *
 * Props:
 *   fill  — the buttons share the row's width (forms) instead of sitting at
 *           its right end (modals).
 *   inset — page forms: lines up with the `.formSection` cards above it, with a
 *           secondary as wide as theirs and the primary taking the rest.
 */
export default function FormActions({ fill = false, inset = false, className, children }) {
  return <div className={cx(s.actions, fill && s.fill, inset && s.inset, className)}>{children}</div>
}
