import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import shared from '../styles/shared.module.css'
import s from './LotSelectionModal.module.css'

/**
 * Modal for selecting specific lots to consume when confirming a routine.
 *
 * Props:
 *   routine  — object with { name, stock_usage, stock_name }
 *   lots     — expanded unit list from /lots-for-selection/ endpoint
 *   onConfirm(lotSelections) — called with [{lot_id, quantity}] grouped
 *   onCancel
 */
export default function LotSelectionModal({ routine, lots, onConfirm, onCancel }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState([]) // array of unit keys "lotId-unitIndex"
  const [error, setError] = useState(null)
  const needed = routine.stock_usage

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const unitKey = (unit) => `${unit.lot_id}-${unit.unit_index}`

  const handleToggle = (unit) => {
    const key = unitKey(unit)
    if (needed === 1) {
      // Single selection — radio-like behaviour
      setSelected([key])
      setError(null)
      return
    }
    setSelected((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key)
      return [...prev, key]
    })
    setError(null)
  }

  const handleConfirm = () => {
    if (selected.length !== needed) {
      setError(t('lot.modal.errorCount', { count: needed }))
      return
    }

    // Group selected units by lot_id and count quantities
    const counts = {}
    for (const key of selected) {
      const unit = lots.find((u) => unitKey(u) === key)
      if (!unit) continue
      counts[unit.lot_id] = (counts[unit.lot_id] || 0) + 1
    }

    const lotSelections = Object.entries(counts).map(([lot_id, quantity]) => ({
      lot_id: Number(lot_id),
      quantity,
    }))

    onConfirm(lotSelections)
  }

  const lotLabel = (unit) => {
    const id = unit.lot_number ?? t('lot.modal.noId')
    return `${id} (${unit.unit_index})`
  }

  return (
    <div className={shared.overlay} onClick={onCancel} role="dialog" aria-modal="true">
      <div className={s.box} onClick={(e) => e.stopPropagation()}>
        <h2 className={s.title}>{t('lot.modal.title')}</h2>
        <p className={s.subtitle}>{t('lot.modal.subtitle', { count: needed })}</p>

        <ul className={s.list}>
          {lots.map((unit) => {
            const key = unitKey(unit)
            const isSelected = selected.includes(key)
            return (
              <li
                key={key}
                className={`${s.item} ${isSelected ? s.itemSelected : ''}`}
                onClick={() => handleToggle(unit)}
                role={needed === 1 ? 'radio' : 'checkbox'}
                aria-checked={isSelected}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleToggle(unit)}
              >
                <span className={s.indicator}>{isSelected ? '✓' : ''}</span>
                <span className={s.label}>{lotLabel(unit)}</span>
                {unit.expiry_date && <span className={s.expiry}>{unit.expiry_date}</span>}
              </li>
            )
          })}
        </ul>

        {error && <p className={s.error}>{error}</p>}

        <div className={s.actions}>
          <button className={s.cancelBtn} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button className={s.confirmBtn} onClick={handleConfirm}>
            {t('lot.modal.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
