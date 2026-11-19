import { Children, cloneElement, isValidElement, useId } from 'react'
import cx from '../utils/cx'
import forms from '../styles/forms.module.css'
import s from './FormField.module.css'

// Native controls a <label for> can name.
const LABELABLE = new Set(['input', 'textarea', 'select'])

/**
 * Form field wrapper: optional label (with optional hint suffix),
 * children (the input itself), and an optional error message under
 * the input. Matches the visual register used throughout the form
 * pages (RoutineFormPage, StockFormPage, StockDetailPage).
 *
 * The label is a SIBLING of children (not a wrapper) — wrapping
 * complex children like IntervalPicker (multiple buttons) inside
 * a `<label>` corrupts the accessible name of the inner controls.
 *
 * **The label names its control** (WCAG 1.3.1 / 4.1.2, the a11y E2E):
 *   - when the only child is a native `input` / `textarea` / `select`, the
 *     field gives it an id (unless it has one) and points the label at it;
 *   - when the control sits inside a wrapper (e.g. a lock badge beside it),
 *     the caller passes `controlId` and puts that id on the control;
 *   - complex children (IntervalPicker, toggles) are left alone: they name
 *     their own controls.
 *
 * **Required vs optional is one convention, and it lives here.** A required
 * field passes `required` and gets an asterisk; an optional one is simply
 * left unmarked. Do NOT hand `hint` the word "optional" to mark the other
 * direction, and do not bake "(optional)" into a translation string — both
 * were tried, in the same form, and the result was four fields announcing
 * themselves three different ways. `hint` is for genuine extra detail
 * ("· UTC", "· max 20 characters").
 *
 * The asterisk is `aria-hidden`: a lone "*" read aloud means nothing. A
 * native child gets `aria-required` instead, so assistive tech hears it.
 */
export default function FormField({ label, children, error, hint, required, controlId }) {
  const generatedId = useId()
  const only = Children.count(children) === 1 && isValidElement(children) ? children : null
  const nativeChild = only && LABELABLE.has(only.type) ? only : null
  const id = controlId ?? nativeChild?.props.id ?? (nativeChild ? generatedId : undefined)
  const control = nativeChild
    ? cloneElement(nativeChild, {
        id,
        ...(required && nativeChild.props['aria-required'] === undefined && { 'aria-required': true }),
      })
    : children

  return (
    <div className={s.field}>
      {label && (
        <label className={cx(forms.inputLabel, s.label)} htmlFor={id}>
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
      {control}
      {error && <p className={forms.error}>{error}</p>}
    </div>
  )
}
