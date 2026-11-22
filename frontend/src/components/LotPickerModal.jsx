import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConsumeStock } from '../hooks/mutations/useConsumeStock'
import { errorToastMessage } from '../utils/errors'
import { expiryToday, lotsForSelection } from '../utils/lotsForSelection'
import LotConsumeModal from './LotConsumeModal'

/**
 * Single-unit lot picker, opened by `useConsumeOne` when there is more than
 * one lot to choose from. Fires `useConsumeStock` with quantity = 1.
 *
 * The selection itself is `LotConsumeModal` with `needed = 1`: the same lot
 * list (never the box), the same wire format. What belongs here is only what makes this
 * entry point different — it owns the mutation, and its copy says so.
 *
 * Props:
 *   stock      — stock object containing at least `id`, `name`, `lots[]`
 *   onClose    — called when the user dismisses without consuming
 *   onConsumed — optional, fired with the mutation's result after a success
 */
export default function LotPickerModal({ stock, onClose, onConsumed }) {
  const { t } = useTranslation()
  const consumeStock = useConsumeStock()
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const consume = async (lotSelections) => {
    setSubmitting(true)
    setError(null)
    try {
      const result = await consumeStock.mutateAsync({
        stockId: stock.id,
        stockName: stock.name,
        quantity: 1,
        lotSelections,
      })
      onConsumed?.(result)
      onClose()
    } catch (err) {
      // Never an OfflineError: `useConsumeStock` is queueable, so losing the
      // network enqueues the consume and resolves instead of throwing. What
      // reaches here is a real server refusal. A coded one (`insufficient_stock`)
      // says why, with the numbers; the rest resolves as errorToastMessage does.
      setError(errorToastMessage(err, t, 'lotPicker.errorGeneric'))
      setSubmitting(false)
    }
  }

  return (
    <LotConsumeModal
      groups={lotsForSelection(stock, expiryToday())}
      needed={1}
      title={t('lotPicker.title')}
      subtitle={t('lotPicker.subtitle', { name: stock.name })}
      confirmLabel={submitting ? t('lotPicker.consuming') : t('lotPicker.confirm')}
      cancelLabel={t('lotPicker.cancel')}
      emptyMessage={t('lotPicker.noLots')}
      error={error}
      busy={submitting}
      onConfirm={consume}
      // The modal must not vanish under a consume that is still in flight, so
      // Escape and the overlay are held until it settles.
      onCancel={submitting ? () => {} : onClose}
    />
  )
}
