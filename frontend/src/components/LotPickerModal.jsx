import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConsumeStock } from '../hooks/mutations/useConsumeStock'
import { OfflineError } from '../api/errors'
import { lotsForSelection } from '../utils/lotsForSelection'
import ModalFrame from './ModalFrame'
import shared from '../styles/shared.module.css'
import s from './LotSelectionModal.module.css'

/**
 * Single-unit lot picker invoked from the InventoryPage −1 button.
 * Always opened explicitly (even with one lot) so a tap on a card is
 * never a silent mutation. Fires `useConsumeStock` with quantity = 1
 * and the selected lot_id.
 *
 * Props:
 *   stock      — stock object containing at least `id`, `name`, `lots[]`
 *   onClose    — called when the user dismisses without consuming
 *   onConsumed — optional, fired after a successful consume
 */
export default function LotPickerModal({ stock, onClose, onConsumed }) {
  const { t } = useTranslation()
  const consumeStock = useConsumeStock()
  const lots = lotsForSelection(stock)
  const [selectedLotId, setSelectedLotId] = useState(lots.length > 0 ? lots[0].lot_id : null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const guardedClose = submitting ? () => {} : onClose

  const handleConfirm = async () => {
    if (selectedLotId == null) return
    setSubmitting(true)
    setError(null)
    try {
      await consumeStock.mutateAsync({
        stockId: stock.id,
        quantity: 1,
        lotSelections: [{ lot_id: selectedLotId, quantity: 1 }],
      })
      onConsumed?.()
      onClose()
    } catch (err) {
      setError(err instanceof OfflineError ? t('offline.actionUnavailable') : t('lotPicker.errorGeneric'))
      setSubmitting(false)
    }
  }

  const lotLabel = (lot) => lot.lot_number ?? t('lot.modal.noId')

  return (
    <ModalFrame onClose={guardedClose}>
      <h2 className={s.title}>{t('lotPicker.title')}</h2>
      <p className={s.subtitle}>{t('lotPicker.subtitle', { name: stock.name })}</p>

      {lots.length === 0 ? (
        <p className={s.error}>{t('lotPicker.noLots')}</p>
      ) : (
        <ul className={s.list} role="radiogroup" aria-label={t('lotPicker.title')}>
          {lots.map((lot) => {
            const selected = selectedLotId === lot.lot_id
            return (
              <li
                key={lot.lot_id}
                className={`${s.item} ${selected ? s.itemSelected : ''}`}
                onClick={() => setSelectedLotId(lot.lot_id)}
                role="radio"
                aria-checked={selected}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setSelectedLotId(lot.lot_id)}
              >
                <span className={s.radio}>{selected ? '●' : ''}</span>
                <span className={s.label}>{lotLabel(lot)}</span>
                <span className={s.available}>
                  {lot.quantity} {t('lot.modal.available')}
                </span>
                {lot.expiry_date && <span className={s.expiry}>{lot.expiry_date}</span>}
              </li>
            )
          })}
        </ul>
      )}

      {error && <p className={s.error}>{error}</p>}

      <div className={s.actions}>
        <button type="button" className={shared.btnCancel} onClick={onClose} disabled={submitting}>
          {t('lotPicker.cancel')}
        </button>
        <button
          type="button"
          className={shared.btnConfirm}
          onClick={handleConfirm}
          disabled={submitting || selectedLotId == null}
        >
          {submitting ? t('lotPicker.consuming') : t('lotPicker.confirm')}
        </button>
      </div>
    </ModalFrame>
  )
}
