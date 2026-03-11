import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import shared from '../styles/shared.module.css'
import s from './GroupPickerModal.module.css'

export default function GroupPickerModal({ groups, currentGroupId, onSelect, onClose }) {
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
          <h2 className={s.title}>{t('inventory.assignGroup')}</h2>
          <button className={s.xBtn} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className={s.subtitle}>{t('inventory.assignGroupSubtitle')}</p>
        <ul className={s.list}>
          <li
            className={`${s.item} ${!currentGroupId ? s.itemSelected : ''}`}
            onClick={() => onSelect(null)}
            role="radio"
            aria-checked={!currentGroupId}
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(null)}
          >
            <span className={s.radio}>{!currentGroupId ? '●' : ' '}</span>
            <span className={s.name}>{t('inventory.noGroup')}</span>
          </li>
          {groups.map((group) => {
            const selected = currentGroupId === group.id
            return (
              <li
                key={group.id}
                className={`${s.item} ${selected ? s.itemSelected : ''}`}
                onClick={() => onSelect(group.id)}
                role="radio"
                aria-checked={selected}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onSelect(group.id)}
              >
                <span className={s.radio}>{selected ? '●' : ' '}</span>
                <span className={s.name}>{group.name}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
