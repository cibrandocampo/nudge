import { useTranslation } from 'react-i18next'
import ModalFrame from './ModalFrame'
import cx from '../utils/cx'
import buttons from '../styles/buttons.module.css'
import s from './StockValuesConfirmModal.module.css'

// Human labels for the fields `reconcileStockFromLot` can report. Keeping the
// map here — rather than deriving a key from the field name — means an unknown
// field shows its raw name instead of a missing-translation warning.
const FIELD_LABELS = {
  name: 'stockValues.fieldName',
  gtin: 'stockValues.fieldGtin',
  national_code: 'stockValues.fieldNationalCode',
  default_lot_quantity: 'stockValues.fieldDefaultLotQuantity',
}

// Fields holding free text rather than a code: laid out to be read, not compared
// digit by digit (see `.valuesText`).
const TEXT_FIELDS = new Set(['name'])

/**
 * Asks whether a saved lot should redefine the product's stored values.
 *
 * Only reached for a genuine disagreement: a blank value is filled silently by
 * `reconcileStockFromLot`, and matching values never get here. The case that
 * justifies the prompt is a one-off quantity — registering the 6 leftovers of
 * an opened 10-pack must not quietly become the new default.
 *
 * **Neither outcome is destructive.** The lot is created either way; this only
 * decides whether the product's defaults change. Hence no danger styling, and
 * "keep" is a plain cancel rather than a warning.
 *
 * Props:
 *   discrepancies — `[{ field, current, next }]`, straight from the helper
 *   onConfirm     — adopt the new values
 *   onCancel      — leave the product untouched
 *   title, intro  — i18n keys; default to the lot wording. The official-name
 *                   offer (T112) reuses the modal with its own copy
 *   introValues   — interpolation values for `intro`
 *   busy          — an answer is in flight: both actions are held
 *   onDismiss     — closing (X, Escape, backdrop) without answering; defaults
 *                   to `onCancel`, which is what the lot question wants
 */
export default function StockValuesConfirmModal({
  discrepancies,
  onConfirm,
  onCancel,
  title = 'stockValues.title',
  intro = 'stockValues.intro',
  introValues,
  busy = false,
  onDismiss,
}) {
  const { t } = useTranslation()

  return (
    // `ModalFrame` renders only its own props, so the testid lives on a wrapper
    // inside it rather than being silently dropped.
    <ModalFrame onClose={onDismiss ?? onCancel} title={t(title)}>
      <div data-testid="stock-values-confirm">
        <p className={s.intro}>{t(intro, introValues)}</p>
        <ul className={s.list}>
          {discrepancies.map(({ field, current, next }) => (
            <li key={field} className={s.row} data-testid="stock-values-row">
              <span className={s.field}>{FIELD_LABELS[field] ? t(FIELD_LABELS[field]) : field}</span>
              <span className={cx(s.values, TEXT_FIELDS.has(field) && s.valuesText)}>
                {/* Rendered as-is: a GTIN is a string whose leading zero is
                    significant, so it must never pass through numeric formatting. */}
                <span className={s.current} data-testid="stock-values-current">
                  {formatValue(current)}
                </span>
                <span className={s.arrow} aria-hidden="true">
                  →
                </span>
                <span className={s.next} data-testid="stock-values-next">
                  {formatValue(next)}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <div className={s.actions}>
          <button className={buttons.btnCancel} onClick={onCancel} disabled={busy} data-testid="stock-values-keep">
            {t('stockValues.keep')}
          </button>
          <button className={buttons.btnConfirm} onClick={onConfirm} disabled={busy} data-testid="stock-values-update">
            {t('stockValues.update')}
          </button>
        </div>
      </div>
    </ModalFrame>
  )
}

/**
 * A blank current value should never reach this modal — the helper puts those
 * in `silent` — but rendering `undefined` would be a worse bug than showing an
 * em dash, so guard rather than assume.
 */
function formatValue(value) {
  if (value === '' || value === null || value === undefined) return '—'
  return String(value)
}
