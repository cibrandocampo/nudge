import { useTranslation } from 'react-i18next'
import { useEscapeKey } from '../hooks/useEscapeKey'
import cx from '../utils/cx'
import shared from '../styles/shared.module.css'

export default function ModalFrame({ onClose, title, size = 'sm', variant = 'box', closeAriaLabel, children }) {
  const { t } = useTranslation()
  useEscapeKey(onClose)

  const stopPropagation = (e) => e.stopPropagation()
  const ariaLabel = !title ? (closeAriaLabel ?? t('common.close')) : undefined

  if (variant === 'framed') {
    return (
      <div className={shared.overlay} onClick={onClose}>
        <div
          className={cx(shared.modalBoxFramed, size === 'md' && shared.modalBoxMd, size === 'lg' && shared.modalBoxLg)}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          onClick={stopPropagation}
        >
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className={shared.overlay} onClick={onClose}>
      <div
        className={cx(shared.modalBox, size === 'md' && shared.modalBoxMd, size === 'lg' && shared.modalBoxLg)}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={stopPropagation}
      >
        {title && <h2 className={shared.modalTitle}>{title}</h2>}
        {children}
      </div>
    </div>
  )
}
