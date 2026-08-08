import { useTranslation } from 'react-i18next'
import { useEscapeKey } from '../hooks/useEscapeKey'
import cx from '../utils/cx'
import layout from '../styles/layout.module.css'
export default function ModalFrame({ onClose, title, size = 'sm', variant = 'box', closeAriaLabel, children }) {
  const { t } = useTranslation()
  useEscapeKey(onClose)

  const stopPropagation = (e) => e.stopPropagation()
  const ariaLabel = !title ? (closeAriaLabel ?? t('common.close')) : undefined

  if (variant === 'framed') {
    return (
      <div className={layout.overlay} onClick={onClose}>
        <div
          className={cx(layout.modalBoxFramed, size === 'md' && layout.modalBoxMd, size === 'lg' && layout.modalBoxLg)}
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
    <div className={layout.overlay} onClick={onClose}>
      <div
        className={cx(layout.modalBox, size === 'md' && layout.modalBoxMd, size === 'lg' && layout.modalBoxLg)}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={stopPropagation}
      >
        {title && <h2 className={layout.modalTitle}>{title}</h2>}
        {children}
      </div>
    </div>
  )
}
