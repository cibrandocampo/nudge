import cx from '../utils/cx'
import shared from '../styles/shared.module.css'
import s from './FormField.module.css'

/**
 * Form field wrapper: optional label (with optional hint suffix),
 * children (the input itself), and an optional error message under
 * the input. Matches the visual register used throughout the form
 * pages (RoutineFormPage, StockFormPage, StockDetailPage).
 *
 * The label is a SIBLING of children (not a wrapper) — wrapping
 * complex children like IntervalPicker (multiple buttons) inside
 * a `<label>` corrupts the accessible name of the inner controls.
 * Tests that rely on label-input association should use placeholder
 * text, role queries, or aria-label instead of `getByLabelText`.
 */
export default function FormField({ label, children, error, hint }) {
  return (
    <div className={s.field}>
      {label && (
        <label className={cx(shared.inputLabel, s.label)}>
          {label}
          {hint && <span className={s.hint}> · {hint}</span>}
        </label>
      )}
      {children}
      {error && <p className={shared.error}>{error}</p>}
    </div>
  )
}
