import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import shared from '../styles/shared.module.css'
import s from './ConfirmModal.module.css'

export default function ConfirmModal({ message, onConfirm, onCancel, confirmLabel }) {
  const { t } = useTranslation()

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className={shared.overlay} onClick={onCancel} role="dialog" aria-modal="true">
      <div className={shared.modalBox} onClick={(e) => e.stopPropagation()}>
        <p className={s.message}>{message}</p>
        <div className={s.actions}>
          <button className={s.cancelBtn} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button className={s.confirmBtn} onClick={onConfirm}>
            {confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
