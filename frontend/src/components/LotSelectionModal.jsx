import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import shared from '../styles/shared.module.css'
import s from './LotSelectionModal.module.css'

/**
 * Modal for selecting specific lots to consume when confirming a routine.
 *
 * Props:
 *   routine  — object with { name, stock_usage, stock_name }
 *   lots     — grouped lot list from /lots-for-selection/ endpoint
 *              [{lot_id, lot_number, expiry_date, quantity}]
 *   onConfirm(lotSelections) — called with [{lot_id, quantity}]
 *   onCancel
 */
export default function LotSelectionModal({ routine, lots, onConfirm, onCancel }) {
  const { t } = useTranslation()
  const needed = routine.stock_usage
  const isSingle = needed === 1

  // Single mode state
  const [selectedLotId, setSelectedLotId] = useState(isSingle && lots.length > 0 ? lots[0].lot_id : null)

  // Multi mode state — pre-distribute using FEFO order (lots come pre-sorted)
  const [quantities, setQuantities] = useState(() => {
    const init = Object.fromEntries(lots.map((lot) => [lot.lot_id, 0]))
    let remaining = needed
    for (const lot of lots) {
      if (remaining <= 0) break
      const take = Math.min(lot.quantity, remaining)
      init[lot.lot_id] = take
      remaining -= take
    }
    return init
  })

  const [error, setError] = useState(null)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const total = isSingle ? (selectedLotId != null ? 1 : 0) : Object.values(quantities).reduce((sum, q) => sum + q, 0)

  const handleSelectRadio = (lotId) => {
    setSelectedLotId(lotId)
    setError(null)
  }

  const handleStep = (lotId, maxQty, delta) => {
    setQuantities((prev) => {
      const next = Math.max(0, Math.min(maxQty, prev[lotId] + delta))
      return { ...prev, [lotId]: next }
    })
    setError(null)
  }

  const handleConfirm = () => {
    if (isSingle) {
      if (selectedLotId == null) {
        setError(t('lot.modal.errorTotal', { needed, total: 0 }))
        return
      }
      onConfirm([{ lot_id: selectedLotId, quantity: 1 }])
    } else {
      if (total !== needed) {
        setError(t('lot.modal.errorTotal', { needed, total }))
        return
      }
      const selections = Object.entries(quantities)
        .filter(([, qty]) => qty > 0)
        .map(([lotId, qty]) => ({ lot_id: Number(lotId), quantity: qty }))
      onConfirm(selections)
    }
  }

  const lotLabel = (lot) => lot.lot_number ?? t('lot.modal.noId')

  return (
    <div className={shared.overlay} onClick={onCancel} role="dialog" aria-modal="true">
      <div className={s.box} onClick={(e) => e.stopPropagation()}>
        <h2 className={s.title}>{t('lot.modal.title')}</h2>
        <p className={s.subtitle}>
          {isSingle ? t('lot.modal.subtitleSingle') : t('lot.modal.subtitleMulti', { count: needed })}
        </p>

        <ul className={s.list}>
          {lots.map((lot) =>
            isSingle ? (
              <li
                key={lot.lot_id}
                className={`${s.item} ${selectedLotId === lot.lot_id ? s.itemSelected : ''}`}
                onClick={() => handleSelectRadio(lot.lot_id)}
                role="radio"
                aria-checked={selectedLotId === lot.lot_id}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleSelectRadio(lot.lot_id)}
              >
                <span className={s.radio}>{selectedLotId === lot.lot_id ? '●' : ''}</span>
                <span className={s.label}>{lotLabel(lot)}</span>
                <span className={s.available}>
                  {lot.quantity} {t('lot.modal.available')}
                </span>
                {lot.expiry_date && <span className={s.expiry}>{lot.expiry_date}</span>}
              </li>
            ) : (
              <li key={lot.lot_id} className={s.itemMulti}>
                <div className={s.lotHeader}>
                  <span className={s.label}>{lotLabel(lot)}</span>
                  <span className={s.available}>
                    {lot.quantity} {t('lot.modal.available')}
                  </span>
                  {lot.expiry_date && <span className={s.expiry}>{lot.expiry_date}</span>}
                </div>
                <div className={s.qtyRow}>
                  <button
                    type="button"
                    className={s.stepBtn}
                    disabled={quantities[lot.lot_id] <= 0}
                    onClick={() => handleStep(lot.lot_id, lot.quantity, -1)}
                    aria-label="Decrease"
                  >
                    -
                  </button>
                  <span className={s.qtyValue}>{quantities[lot.lot_id]}</span>
                  <button
                    type="button"
                    className={s.stepBtn}
                    disabled={quantities[lot.lot_id] >= lot.quantity}
                    onClick={() => handleStep(lot.lot_id, lot.quantity, 1)}
                    aria-label="Increase"
                  >
                    +
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>

        {!isSingle && (
          <p className={s.totalRow}>
            {t('lot.modal.total')}:{' '}
            <span className={s.qty}>
              {total}/{needed}
            </span>
          </p>
        )}

        {error && <p className={s.error}>{error}</p>}

        <div className={s.actions}>
          <button className={s.cancelBtn} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button className={s.confirmBtn} onClick={handleConfirm} disabled={!isSingle && total !== needed}>
            {t('lot.modal.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
