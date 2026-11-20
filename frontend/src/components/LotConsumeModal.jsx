import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ModalFrame from './ModalFrame'
import { allocateFromGroup } from '../utils/lotsForSelection'
import buttons from '../styles/buttons.module.css'
import s from './LotConsumeModal.module.css'

/**
 * The one flow for choosing which units of a stock to consume.
 *
 * The user picks the **lot** — one row per group from `lotsForSelection()` —
 * and never the box: a unit carries its lot number and expiry, not the serial
 * of the box it came from. Inside each chosen lot the units are taken in
 * consumption order, the opened box first (`allocateFromGroup`).
 *
 * `onConfirm` receives the wire format the API expects: `[{lot_id, quantity}]`.
 *
 * Both entry points share this component: a routine confirmation allocating
 * `stock_usage` units, and the inventory −1 button allocating exactly one. The
 * single-unit case is not a second flow, it is this one with `needed = 1` —
 * the list collapses to a radio list.
 *
 * Props:
 *   groups   — grouped lot list, in consumption order, from `lotsForSelection()`
 *   needed   — units to allocate
 *   title / subtitle — copy; each entry point keeps its own wording
 *   confirmLabel / cancelLabel — action copy, same reason
 *   emptyMessage — shown in place of the list when there is nothing to consume
 *   error    — a failure owned by the caller, e.g. a rejected mutation
 *   busy     — a mutation is in flight: the actions are held
 *   onConfirm(lotSelections) — called with [{lot_id, quantity}]
 *   onCancel
 */
export default function LotConsumeModal({
  groups,
  needed,
  title,
  subtitle,
  confirmLabel,
  cancelLabel,
  emptyMessage,
  error: callerError = null,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const { t } = useTranslation()
  const isSingle = needed === 1

  const [selectedKey, setSelectedKey] = useState(isSingle && groups.length > 0 ? groups[0].key : null)
  const [quantities, setQuantities] = useState(() => {
    const init = Object.fromEntries(groups.map((group) => [group.key, 0]))
    let remaining = needed
    for (const group of groups) {
      if (remaining <= 0) break
      const take = Math.min(group.quantity, remaining)
      init[group.key] = take
      remaining -= take
    }
    return init
  })
  const [error, setError] = useState(null)

  // Copy defaults to the routine-confirmation wording; an entry point with its
  // own vocabulary passes its own rather than repeating this conditional.
  const heading = title ?? t('lot.modal.title')
  const subheading =
    subtitle ?? (isSingle ? t('lot.modal.subtitleSingle') : t('lot.modal.subtitleMulti', { count: needed }))
  const confirmText = confirmLabel ?? t('lot.modal.confirm')
  const cancelText = cancelLabel ?? t('common.cancel')

  // A validation error is about what the user just did, so it wins over the
  // caller's — which stands until the next submit clears it.
  const shownError = error ?? callerError

  // An entry point that supplies copy for "nothing to consume" shows it in
  // place of the list; with no list there is nothing to confirm either.
  const showingEmpty = groups.length === 0 && emptyMessage != null

  const allocatedFor = (group) => (isSingle ? (selectedKey === group.key ? 1 : 0) : quantities[group.key])
  const total = groups.reduce((sum, group) => sum + allocatedFor(group), 0)

  const handleSelectRadio = (key) => {
    setSelectedKey(key)
    setError(null)
  }

  const handleStep = (key, maxQty, delta) => {
    setQuantities((prev) => ({ ...prev, [key]: Math.max(0, Math.min(maxQty, prev[key] + delta)) }))
    setError(null)
  }

  const handleConfirm = () => {
    if (total !== needed) {
      setError(t('lot.modal.errorTotal', { needed, total }))
      return
    }
    onConfirm(groups.flatMap((group) => allocateFromGroup(group, allocatedFor(group))))
  }

  const groupLabel = (group) => group.lot_number ?? t('lot.modal.noId')

  return (
    <ModalFrame onClose={onCancel} size="lg">
      <h2 className={s.title}>{heading}</h2>
      <p className={s.subtitle}>{subheading}</p>

      {showingEmpty ? (
        <p className={s.error}>{emptyMessage}</p>
      ) : (
        <ul className={s.list} role={isSingle ? 'radiogroup' : undefined} aria-label={isSingle ? heading : undefined}>
          {groups.map((group) =>
            isSingle ? (
              <li
                key={group.key}
                className={`${s.item} ${selectedKey === group.key ? s.itemSelected : ''}`}
                onClick={() => handleSelectRadio(group.key)}
                role="radio"
                aria-checked={selectedKey === group.key}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleSelectRadio(group.key)}
                data-testid="lot-group-row"
              >
                <span className={s.radio}>{selectedKey === group.key ? '●' : ''}</span>
                <span className={s.label}>{groupLabel(group)}</span>
                <span className={s.available}>
                  {group.quantity} {t('lot.modal.available')}
                </span>
                {group.expiry_date && <span className={s.expiry}>{group.expiry_date}</span>}
              </li>
            ) : (
              <li key={group.key} className={s.itemMulti} data-testid="lot-group-row">
                <div className={s.lotHeader}>
                  <span className={s.label}>{groupLabel(group)}</span>
                  <span className={s.available}>
                    {group.quantity} {t('lot.modal.available')}
                  </span>
                  {group.expiry_date && <span className={s.expiry}>{group.expiry_date}</span>}
                </div>
                <div className={s.qtyRow}>
                  <button
                    type="button"
                    className={s.stepBtn}
                    disabled={quantities[group.key] <= 0}
                    onClick={() => handleStep(group.key, group.quantity, -1)}
                    aria-label="Decrease"
                  >
                    -
                  </button>
                  <span className={s.qtyValue}>{quantities[group.key]}</span>
                  <button
                    type="button"
                    className={s.stepBtn}
                    disabled={quantities[group.key] >= group.quantity}
                    onClick={() => handleStep(group.key, group.quantity, 1)}
                    aria-label="Increase"
                  >
                    +
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      {!isSingle && (
        <p className={s.totalRow}>
          {t('lot.modal.total')}:{' '}
          <span className={s.qty}>
            {total}/{needed}
          </span>
        </p>
      )}

      {shownError && <p className={s.error}>{shownError}</p>}

      <div className={s.actions}>
        <button className={buttons.btnCancel} onClick={onCancel} disabled={busy}>
          {cancelText}
        </button>
        <button
          className={buttons.btnConfirm}
          onClick={handleConfirm}
          disabled={busy || showingEmpty || (!isSingle && total !== needed)}
        >
          {confirmText}
        </button>
      </div>
    </ModalFrame>
  )
}
