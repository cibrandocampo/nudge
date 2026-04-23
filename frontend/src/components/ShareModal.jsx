import { useTranslation } from 'react-i18next'
import Icon from './Icon'
import ModalFrame from './ModalFrame'
import s from './ShareModal.module.css'

export default function ShareModal({ contacts, sharedWith, onToggle, onClose }) {
  const { t } = useTranslation()

  return (
    <ModalFrame onClose={onClose} size="md">
      <div className={s.header}>
        <h2 className={s.title}>{t('sharing.shareWith')}</h2>
        <button type="button" className={s.xBtn} onClick={onClose} aria-label={t('common.close')}>
          <Icon name="x" size="sm" />
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
    </ModalFrame>
  )
}
