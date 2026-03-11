import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import shared from '../styles/shared.module.css'
import s from './ShareModal.module.css'

export default function ShareModal({ contacts, sharedWith, onToggle, onClose }) {
  const { t } = useTranslation()

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={shared.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={shared.modalBox} onClick={(e) => e.stopPropagation()}>
        <div className={s.header}>
          <h2 className={s.title}>{t('sharing.shareWith')}</h2>
          <button className={s.xBtn} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className={s.subtitle}>{t('sharing.shareWithSubtitle')}</p>
        <ul className={s.list}>
          {contacts.map((contact) => {
            const isShared = (sharedWith || []).includes(contact.id)
            return (
              <li
                key={contact.id}
                className={`${s.item} ${isShared ? s.itemSelected : ''}`}
                onClick={() => onToggle(contact.id)}
              >
                <span className={s.name}>{contact.username}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
