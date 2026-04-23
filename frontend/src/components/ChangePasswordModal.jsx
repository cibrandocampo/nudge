import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import ModalFrame from './ModalFrame'
import PasswordInput from './PasswordInput'
import shared from '../styles/shared.module.css'
import s from './ChangePasswordModal.module.css'

export default function ChangePasswordModal({ onClose }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const handle = async (e) => {
    e.preventDefault()
    if (form.next !== form.confirm) {
      setError(t('header.passwordMismatch'))
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
    } else {
      const data = await res.json()
      setError(data.detail || t('header.passwordError'))
    }
  }

  return (
    <ModalFrame onClose={onClose} title={t('header.changePassword')} size="lg">
      {saved ? (
        <p className={s.success}>{t('header.passwordSaved')}</p>
      ) : (
        <form onSubmit={handle} className={s.form}>
          <PasswordInput
            placeholder={t('header.currentPassword')}
            value={form.current}
            onChange={set('current')}
            required
            autoFocus
          />
          <PasswordInput placeholder={t('header.newPassword')} value={form.next} onChange={set('next')} required />
          <PasswordInput
            placeholder={t('header.confirmPassword')}
            value={form.confirm}
            onChange={set('confirm')}
            required
          />
          {error && <p className={shared.error}>{error}</p>}
          <div className={s.actions}>
            <button type="button" className={shared.btnCancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={shared.btnConfirm} disabled={saving}>
              {saving ? t('header.saving') : t('header.save')}
            </button>
          </div>
        </form>
      )}
    </ModalFrame>
  )
}
