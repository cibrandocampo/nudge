import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ModalFrame from './ModalFrame'
import buttons from '../styles/buttons.module.css'
import s from './LogDateModal.module.css'

// Format a Date as the local wall-clock value a `datetime-local` input expects
// (`YYYY-MM-DDTHH:mm`, no timezone suffix).
function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Modal to pick the real date/time a routine was done (back-dating). Returns
 * the chosen instant to `onConfirm` as an ISO/UTC string; the caller passes it
 * as `client_created_at` to the log mutation. The audit `created_at` stays the
 * server's real logged-at time. Defaults to now and forbids future times.
 */
export default function LogDateModal({ onConfirm, onCancel }) {
  const { t } = useTranslation()
  const [value, setValue] = useState(() => toLocalInputValue(new Date()))
  const max = toLocalInputValue(new Date())

  const handleConfirm = () => {
    // A `datetime-local` input only ever holds '' or a complete, parseable
    // local timestamp — so guarding against empty is sufficient.
    if (!value) return
    onConfirm(new Date(value).toISOString())
  }

  return (
    <ModalFrame onClose={onCancel} title={t('routine.detail.logDateTitle')}>
      <p className={s.hint}>{t('routine.detail.logDateHint')}</p>
      <input
        type="datetime-local"
        className={s.input}
        value={value}
        max={max}
        onChange={(e) => setValue(e.target.value)}
        data-testid="log-date-input"
      />
      <div className={s.actions}>
        <button className={buttons.btnCancel} onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className={buttons.btnConfirm} onClick={handleConfirm} data-testid="log-date-confirm">
          {t('routine.detail.logDateConfirm')}
        </button>
      </div>
    </ModalFrame>
  )
}
