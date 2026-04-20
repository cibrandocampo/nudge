import { useEffect, useRef, useState } from 'react'
import cx from '../utils/cx'
import Icon from './Icon'
import s from './SharePopover.module.css'

export default function SharePopover({ sharedWith, contacts, isOwner, onToggleShare }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!isOwner || !contacts || contacts.length === 0) return null

  const active = sharedWith && sharedWith.length > 0

  return (
    <div className={s.wrap} ref={wrapRef}>
      <button
        type="button"
        className={cx(s.shareBtn, active && s.shareBtnActive)}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        aria-label="Share"
      >
        <Icon name="users" size="sm" />
      </button>
      {open && (
        <div className={s.popover} data-testid="share-popover" onClick={(e) => e.stopPropagation()}>
          {contacts.map((contact) => (
            <label key={contact.id} className={s.popoverItem}>
              <input
                type="checkbox"
                className={s.checkbox}
                checked={(sharedWith || []).includes(contact.id)}
                onChange={(e) => {
                  e.stopPropagation()
                  onToggleShare(contact.id)
                }}
              />
              {contact.username}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
