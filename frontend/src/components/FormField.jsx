import cx from '../utils/cx'
import forms from '../styles/forms.module.css'
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
 *
 * **Required vs optional is one convention, and it lives here.** A required
 * field passes `required` and gets an asterisk; an optional one is simply
 * left unmarked. Do NOT hand `hint` the word "optional" to mark the other
 * direction, and do not bake "(optional)" into a translation string — both
 * were tried, in the same form, and the result was four fields announcing
 * themselves three different ways. `hint` is for genuine extra detail
 * ("· UTC", "· max 20 characters").
 *
 * The asterisk is `aria-hidden`: a lone "*" read aloud means nothing. Mark
 * the control itself instead, so assistive tech gets the real signal.
 */
export default function FormField({ label, children, error, hint, required }) {
  return (
    <div className={s.field}>
      {label && (
        <label className={cx(forms.inputLabel, s.label)}>
          {label}
          {required && (
            <span className={s.required} aria-hidden="true">
              {' '}
              *
            </span>
          )}
          {hint && <span className={s.hint}> · {hint}</span>}
        </label>
      )}
      {children}
      {error && <p className={forms.error}>{error}</p>}
    </div>
  )
}
