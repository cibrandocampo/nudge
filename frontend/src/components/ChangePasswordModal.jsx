import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import FormActions from './FormActions'
import FormField from './FormField'
import ModalFrame from './ModalFrame'
import PasswordInput from './PasswordInput'
import buttons from '../styles/buttons.module.css'
import cx from '../utils/cx'
import { shouldAutoFocus, showInvalid } from '../utils/forms'
import forms from '../styles/forms.module.css'
import s from './ChangePasswordModal.module.css'

const FIELDS = [
  { key: 'current', labelKey: 'header.currentPassword', autoComplete: 'current-password' },
  { key: 'next', labelKey: 'header.newPassword', autoComplete: 'new-password' },
  { key: 'confirm', labelKey: 'header.confirmPassword', autoComplete: 'new-password' },
]

export default function ChangePasswordModal({ onClose }) {
  const { t } = useTranslation()
  const baseId = useId()
  const formRef = useRef(null)
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  // `field` is the input the message is about; null for one about the form.
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))
  const failOn = (field, message) => showInvalid(formRef.current, () => setError({ field, message }))

  const handle = async (e) => {
    e.preventDefault()
    if (form.next !== form.confirm) {
      failOn('confirm', t('header.passwordMismatch'))
      return
    }
    setSaving(true)
    setError(null)
    const res = await api.post('/auth/change-password/', {
      current_password: form.current,
      new_password: form.next,
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(onClose, 1500)
    } else if (res.status === 429) {
      // DRF's throttle detail is English and quotes seconds.
      setError({ field: null, message: t('login.rateLimited') })
    } else {
      const data = await res.json()
      // The API refuses either the current password or the new one's strength.
      const field = /current/i.test(data.detail ?? '') ? 'current' : 'next'
      failOn(field, data.detail || t('header.passwordError'))
    }
  }

  return (
    <ModalFrame
      onClose={onClose}
      title={t('header.changePassword')}
      size="lg"
      dirty={!saved && Object.values(form).some(Boolean)}
    >
      {saved ? (
        <p className={s.success}>{t('header.passwordSaved')}</p>
      ) : (
        <form ref={formRef} onSubmit={handle} className={s.form}>
          {FIELDS.map(({ key, labelKey, autoComplete }, index) => {
            const id = `${baseId}-${key}`
            const fieldError = error?.field === key ? error.message : null
            return (
              <FormField key={key} label={t(labelKey)} controlId={id} errorId={`${id}-error`} error={fieldError}>
                <PasswordInput
                  id={id}
                  value={form[key]}
                  onChange={set(key)}
                  autoComplete={autoComplete}
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? `${id}-error` : undefined}
                  required
                  autoFocus={index === 0 && shouldAutoFocus()}
                />
              </FormField>
            )
          })}
          {error && !error.field && <p className={forms.error}>{error.message}</p>}
          <FormActions>
            <button type="button" className={cx(buttons.btn, buttons.secondary)} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={cx(buttons.btn, buttons.primary)} disabled={saving}>
              {saving ? t('header.saving') : t('header.save')}
            </button>
          </FormActions>
        </form>
      )}
    </ModalFrame>
  )
}
