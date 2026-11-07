import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import PendingBadge from './PendingBadge'
import s from './Header.module.css'

// Signing out lives at the end of Settings (T104), not here: the header is
// the most reachable spot on every screen, wrong for a deliberate action.
export default function Header() {
  const { user } = useAuth()
  const { t } = useTranslation()

  const goToAdmin = () => {
    const token = localStorage.getItem('access_token')
    const form = document.createElement('form')
    form.method = 'POST'
    form.action = '/api/auth/admin-access/'
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = 'token'
    input.value = token
    form.appendChild(input)
    document.body.appendChild(form)
    form.submit()
  }

  return (
    <header className={s.header}>
      <span className={s.logo}>
        nudge
        <span className={s.brandDot} aria-hidden="true" />
      </span>
      <div className={s.right}>
        <PendingBadge />
        {user?.is_staff && (
          <button className={s.adminBtn} onClick={goToAdmin} title="Django admin panel">
            {t('header.admin', 'Admin')}
          </button>
        )}
      </div>
    </header>
  )
}
