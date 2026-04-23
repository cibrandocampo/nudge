import { useTranslation } from 'react-i18next'
import ModalFrame from './ModalFrame'
import cx from '../utils/cx'
import shared from '../styles/shared.module.css'
import s from './ConfirmModal.module.css'

export default function ConfirmModal({ message, onConfirm, onCancel, confirmLabel }) {
  const { t } = useTranslation()

  return (
    <ModalFrame onClose={onCancel}>
      <p className={s.message}>{message}</p>
      <div className={s.actions}>
        <button className={shared.btnCancel} onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className={cx(shared.btnConfirm, shared.btnConfirmDanger)} onClick={onConfirm}>
          {confirmLabel ?? t('common.confirm')}
        </button>
      </div>
    </ModalFrame>
  )
}
