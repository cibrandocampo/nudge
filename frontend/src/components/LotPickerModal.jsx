import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConsumeStock } from '../hooks/mutations/useConsumeStock'
import { lotsForSelection } from '../utils/lotsForSelection'
import LotConsumeModal from './LotConsumeModal'

/**
 * Single-unit lot picker invoked from the InventoryPage −1 button.
 * Always opened explicitly (even with one lot) so a tap on a card is
 * never a silent mutation. Fires `useConsumeStock` with quantity = 1.
 *
 * The selection itself is `LotConsumeModal` with `needed = 1`: same two steps,
 * same skip rule, same wire format. What belongs here is only what makes this
 * entry point different — it owns the mutation, and its copy says so.
 *
 * Props:
 *   stock      — stock object containing at least `id`, `name`, `lots[]`
 *   onClose    — called when the user dismisses without consuming
 *   onConsumed — optional, fired after a successful consume
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
      await consumeStock.mutateAsync({
        stockId: stock.id,
        stockName: stock.name,
        quantity: 1,
        lotSelections,
      })
      onConsumed?.()
      onClose()
    } catch {
      // Never an OfflineError: `useConsumeStock` is queueable, so losing the
      // network enqueues the consume and resolves instead of throwing. What
      // reaches here is a real server refusal.
      setError(t('lotPicker.errorGeneric'))
      setSubmitting(false)
    }
  }

  return (
    <LotConsumeModal
      groups={lotsForSelection(stock)}
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
