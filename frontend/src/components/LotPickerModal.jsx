import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConsumeStock } from '../hooks/mutations/useConsumeStock'
import { OfflineError } from '../api/errors'
import { allocateFromGroup, bulkQuantity, lotsForSelection } from '../utils/lotsForSelection'
import cx from '../utils/cx'
import ModalFrame from './ModalFrame'
import shared from '../styles/shared.module.css'
import s from './LotSelectionModal.module.css'

/**
 * Single-unit lot picker invoked from the InventoryPage −1 button.
 * Always opened explicitly (even with one lot) so a tap on a card is
 * never a silent mutation. Fires `useConsumeStock` with quantity = 1.
 *
 * Selection is two steps when it needs to be: pick the lot, then — only if
 * that lot holds serialized packs — pick which box. A lot with no serials
 * confirms straight from the first step, as before.
 *
 * Props:
 *   stock      — stock object containing at least `id`, `name`, `lots[]`
 *   onClose    — called when the user dismisses without consuming
 *   onConsumed — optional, fired after a successful consume
 */
export default function LotPickerModal({ stock, onClose, onConsumed }) {
  const { t } = useTranslation()
  const consumeStock = useConsumeStock()
  const groups = lotsForSelection(stock)
  const [selectedKey, setSelectedKey] = useState(groups.length > 0 ? groups[0].key : null)
  const [selectedPackId, setSelectedPackId] = useState(null)
  const [step, setStep] = useState('groups')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const guardedClose = submitting ? () => {} : onClose
  const selectedGroup = groups.find((group) => group.key === selectedKey) ?? null

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
    } catch (err) {
      setError(err instanceof OfflineError ? t('offline.actionUnavailable') : t('lotPicker.errorGeneric'))
      setSubmitting(false)
    }
  }

  const handleGroupConfirm = () => {
    if (selectedGroup == null) return
    // Only ask which box when the lot actually holds more than one: a single
    // identified pack is not a choice, it is the answer.
    if (selectedGroup.packs.length > 1) {
      setSelectedPackId(selectedGroup.packs[0].lot_id)
      setStep('packs')
      return
    }
    const onlyPack = selectedGroup.packs.length === 1 ? [selectedGroup.packs[0].lot_id] : []
    consume(allocateFromGroup(selectedGroup, 1, onlyPack))
  }

  const handlePackConfirm = () => {
    consume(allocateFromGroup(selectedGroup, 1, selectedPackId == null ? [] : [selectedPackId]))
  }

  const groupLabel = (group) => group.lot_number ?? t('lot.modal.noId')

  if (step === 'packs' && selectedGroup) {
    return (
      <ModalFrame onClose={guardedClose}>
        <h2 className={s.title}>{t('lot.modal.pickPack')}</h2>
        <p className={s.subtitle}>
          {groupLabel(selectedGroup)} · {t('lot.modal.packCount', { count: selectedGroup.packs.length })}
        </p>

        <ul className={s.list} role="radiogroup" aria-label={t('lot.modal.pickPack')}>
          {selectedGroup.packs.map((pack) => {
            const selected = selectedPackId === pack.lot_id
            return (
              <li
                key={pack.lot_id}
                className={`${s.item} ${selected ? s.itemSelected : ''}`}
                onClick={() => setSelectedPackId(pack.lot_id)}
                role="radio"
                aria-checked={selected}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setSelectedPackId(pack.lot_id)}
                data-testid="pack-row"
                data-lot-id={pack.lot_id}
              >
                <span className={s.radio}>{selected ? '●' : ''}</span>
                {/* The serial stands alone: every pack row in this list is one
                    physical box, so labelling it "Serial" repeats the list. */}
                <span className={cx(s.label, s.packSerial)}>{pack.serial_number}</span>
              </li>
            )
          })}
          {bulkQuantity(selectedGroup) > 0 && (
            <li
              className={`${s.item} ${selectedPackId === null ? s.itemSelected : ''}`}
              onClick={() => setSelectedPackId(null)}
              role="radio"
              aria-checked={selectedPackId === null}
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setSelectedPackId(null)}
              data-testid="bulk-row"
            >
              <span className={s.radio}>{selectedPackId === null ? '●' : ''}</span>
              <span className={s.label}>{t('lot.modal.unidentifiedUnits')}</span>
              <span className={s.available}>
                {bulkQuantity(selectedGroup)} {t('lot.modal.available')}
              </span>
            </li>
          )}
        </ul>

        {error && <p className={s.error}>{error}</p>}

        <div className={s.actions}>
          <button type="button" className={shared.btnCancel} onClick={() => setStep('groups')} disabled={submitting}>
            {t('lot.modal.back')}
          </button>
          <button
            type="button"
            className={shared.btnConfirm}
            onClick={handlePackConfirm}
            disabled={submitting}
            data-testid="pack-confirm"
          >
            {submitting ? t('lotPicker.consuming') : t('lotPicker.confirm')}
          </button>
        </div>
      </ModalFrame>
    )
  }

  return (
    <ModalFrame onClose={guardedClose}>
      <h2 className={s.title}>{t('lotPicker.title')}</h2>
      <p className={s.subtitle}>{t('lotPicker.subtitle', { name: stock.name })}</p>

      {groups.length === 0 ? (
        <p className={s.error}>{t('lotPicker.noLots')}</p>
      ) : (
        <ul className={s.list} role="radiogroup" aria-label={t('lotPicker.title')}>
          {groups.map((group) => {
            const selected = selectedKey === group.key
            return (
              <li
                key={group.key}
                className={`${s.item} ${selected ? s.itemSelected : ''}`}
                onClick={() => setSelectedKey(group.key)}
                role="radio"
                aria-checked={selected}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setSelectedKey(group.key)}
                data-testid="lot-group-row"
              >
                <span className={s.radio}>{selected ? '●' : ''}</span>
                <span className={s.label}>{groupLabel(group)}</span>
                <span className={s.available}>
                  {group.quantity} {t('lot.modal.available')}
                </span>
                {group.expiry_date && <span className={s.expiry}>{group.expiry_date}</span>}
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
          onClick={handleGroupConfirm}
          disabled={submitting || selectedGroup == null}
        >
          {submitting ? t('lotPicker.consuming') : t('lotPicker.confirm')}
        </button>
      </div>
    </ModalFrame>
  )
}
