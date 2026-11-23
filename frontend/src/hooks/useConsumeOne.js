import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../components/useToast'
import { errorToastMessage } from '../utils/errors'
import { vibrateIfOutOfStock, vibrateRefused } from '../utils/haptics'
import { expiryToday, lotsForSelection, needsLotChoice } from '../utils/lotsForSelection'
import { useConsumeStock } from './mutations/useConsumeStock'
import { useUndoConsumeStock } from './mutations/useUndoConsumeStock'

/**
 * The one way to consume a single unit (T129), shared by the inventory and the
 * product page:
 *
 *   1. nothing consumable → refused, with no request;
 *   2. more than one lot to choose from → `pickerStock` is set, and the caller
 *      renders `LotPickerModal` with `closePicker` and `onPickerConsumed`;
 *   3. otherwise → consumed directly, the server applying its order.
 *
 * A consumption made online ends in a toast with Undo. One queued offline has
 * no server id to undo yet, so its toast has none; it can still be discarded
 * from the pending panel.
 *
 * @param {object} [options]
 * @param {(stock: object) => void} [options.onConsumed] after any success.
 */
export function useConsumeOne({ onConsumed } = {}) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const consumeStock = useConsumeStock()
  const undoConsume = useUndoConsumeStock()
  const [pickerStock, setPickerStock] = useState(null)
  const [consumingId, setConsumingId] = useState(null)
  // A ref, not `consumingId`: two taps can land before React re-renders.
  const inFlight = useRef(false)

  const undo = async (stock, consumptionId) => {
    try {
      await undoConsume.mutateAsync({ consumptionId, stockId: stock.id, stockName: stock.name })
    } catch (err) {
      showToast({ type: 'error', message: errorToastMessage(err, t) })
    }
  }

  const announce = (stock, result) => {
    onConsumed?.(stock)
    if (result?.__queued) {
      showToast({ type: 'info', message: t('inventory.consumedQueued', { name: stock.name }) })
      return
    }
    const consumptionId = result?.consumption_id
    showToast({
      type: 'success',
      message: t('inventory.consumedToast', { name: stock.name }),
      duration: 5000,
      action: consumptionId ? { label: t('card.undo'), onClick: () => undo(stock, consumptionId) } : undefined,
    })
  }

  const consumeOne = async (stock) => {
    if (inFlight.current) return
    const groups = lotsForSelection(stock, expiryToday())
    if (groups.length === 0) {
      vibrateRefused()
      showToast({ type: 'error', message: t('errors.insufficientStock', { required: 1, available: 0 }) })
      return
    }
    if (needsLotChoice(groups)) {
      setPickerStock(stock)
      return
    }
    inFlight.current = true
    setConsumingId(stock.id)
    try {
      const result = await consumeStock.mutateAsync({ stockId: stock.id, stockName: stock.name, quantity: 1 })
      announce(stock, result)
    } catch (err) {
      vibrateIfOutOfStock(err)
      showToast({ type: 'error', message: errorToastMessage(err, t) })
    } finally {
      inFlight.current = false
      setConsumingId(null)
    }
  }

  return {
    consumeOne,
    consumingId,
    pickerStock,
    closePicker: () => setPickerStock(null),
    onPickerConsumed: (result) => announce(pickerStock, result),
  }
}
