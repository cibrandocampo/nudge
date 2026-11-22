import { useTranslation } from 'react-i18next'
import buttons from '../styles/buttons.module.css'
import cx from '../utils/cx'

/**
 * The «Edit» / «Done» button of a list section in edit mode (T153). Goes in
 * the section header, next to its title; `useEditMode` owns the state. The
 * label itself says the state (WAI-ARIA: a toggle either keeps its label and
 * uses `aria-pressed`, or changes its label — not both).
 *
 * Offline it cannot enter the mode — every action the mode reveals needs the
 * server — so it refuses the way those actions used to: `aria-disabled`, a
 * title and `onOffline` (the caller's toast) on tap. Leaving the mode is
 * always allowed.
 *
 * Props:
 *   section   — the section's title («Lots»): the accessible name is
 *               «Edit: Lots» / «Done: Lots». It starts with the visible label
 *               (WCAG 2.5.3) and tells it apart from another «Edit» on the
 *               same page (the product's own).
 *   editing   — from `useEditMode`
 *   onToggle  — from `useEditMode`
 *   controls  — id of the list the mode changes (`aria-controls`)
 *   reachable — from `useServerReachable()`
 *   offlineTitle — the title shown while offline
 *   onOffline — called when tapped offline at rest
 *   testId    — `data-testid` (default `edit-toggle`)
 */
export default function EditToggle({
  section,
  editing,
  onToggle,
  controls,
  reachable,
  offlineTitle,
  onOffline,
  testId = 'edit-toggle',
}) {
  const { t } = useTranslation()
  const blocked = !reachable && !editing
  const label = editing ? t('edit.done') : t('edit.toggle')
  return (
    <button
      type="button"
      className={cx(buttons.btn, buttons.text, blocked && buttons.disabled)}
      onClick={blocked ? onOffline : onToggle}
      aria-label={t('edit.named', { action: label, section })}
      aria-controls={controls}
      aria-disabled={blocked || undefined}
      title={blocked ? offlineTitle : undefined}
      data-testid={testId}
    >
      {label}
    </button>
  )
}
