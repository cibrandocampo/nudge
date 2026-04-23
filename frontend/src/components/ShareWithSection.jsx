import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'
import ShareModal from './ShareModal'
import cx from '../utils/cx'
import shared from '../styles/shared.module.css'
import s from './ShareWithSection.module.css'

/**
 * Share picker block for forms. Renders a card section with a label, a
 * "Share with…" button and a row of chips for the selected contacts.
 * Opens the existing `<ShareModal>` to toggle contacts on/off.
 *
 * Controlled component: the caller owns the `value` array and receives
 * every change via `onChange(nextIds)`. `ShareWithSection` never writes
 * to localStorage or fires mutations — the parent form decides when to
 * persist.
 *
 * Shared-blue accent mirrors the "shared" semantic the app already uses
 * on stock / routine cards (`--c-shared` + `--c-shared-light`).
 *
 * Props:
 *   value: number[]            — contact IDs currently shared with
 *   onChange: (ids) => void    — new id list on every toggle
 *   contacts: Contact[]        — full list the user can share with
 *   disabled: boolean          — external lock (e.g. offline)
 *   label: string              — section header copy
 */
export default function ShareWithSection({ value = [], onChange, contacts = [], disabled = false, label }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const selected = contacts.filter((c) => value.includes(c.id))
  const noContacts = contacts.length === 0
  const buttonDisabled = disabled || noContacts

  const toggle = (contactId) => {
    onChange(value.includes(contactId) ? value.filter((x) => x !== contactId) : [...value, contactId])
  }

  const remove = (contactId) => onChange(value.filter((x) => x !== contactId))

  return (
    <section className={shared.formSection}>
      <div className={shared.formSectionHeader}>
        <span className={shared.formSectionTitle}>{label}</span>
        <button
          type="button"
          className={cx(shared.btn, shared.btnSecondary, shared.formSecondaryBtn, s.shareBtn)}
          onClick={() => setOpen(true)}
          disabled={buttonDisabled}
          title={noContacts ? t('stockForm.sharedNoContacts') : undefined}
        >
          <Icon name="user-plus" size="sm" />
          <span>{t('stockForm.shareButton')}</span>
        </button>
      </div>

      {selected.length === 0 ? (
        <p className={shared.helpText}>{noContacts ? t('stockForm.sharedNoContacts') : t('stockForm.sharedEmpty')}</p>
      ) : (
        <div className={shared.formChipsRow}>
          {selected.map((c) => (
            <span key={c.id} className={shared.formChip}>
              <span className={shared.formChipAvatar} aria-hidden="true">
                {c.username.charAt(0).toUpperCase()}
              </span>
              <span>{c.username}</span>
              <button
                type="button"
                className={shared.formChipRemove}
                onClick={() => remove(c.id)}
                aria-label={t('stockForm.removeShare', { name: c.username })}
              >
                <Icon name="x" size="sm" />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && <ShareModal contacts={contacts} sharedWith={value} onToggle={toggle} onClose={() => setOpen(false)} />}
    </section>
  )
}
