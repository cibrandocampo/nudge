import { useTranslation } from 'react-i18next'
import { fullName } from '../utils/displayName'
import ModalFrame from './ModalFrame'
import s from './ShareModal.module.css'

export default function ShareModal({ contacts, sharedWith, onToggle, onClose }) {
  const { t } = useTranslation()

  return (
    <ModalFrame onClose={onClose} size="md" title={t('sharing.shareWith')} subtitle={t('sharing.shareWithSubtitle')}>
      <ul className={s.list}>
        {contacts.map((contact) => {
          const isShared = (sharedWith || []).includes(contact.id)
          return (
            <li
              key={contact.id}
              className={`${s.item} ${isShared ? s.itemSelected : ''}`}
              onClick={() => onToggle(contact.id)}
            >
              <span className={s.name}>{fullName(contact)}</span>
            </li>
          )
        })}
      </ul>
    </ModalFrame>
  )
}
