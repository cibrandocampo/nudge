import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { unsubscribeFromPush } from '../utils/push'
import Icon from './Icon'
import PendingBadge from './PendingBadge'
import s from './Header.module.css'

export default function Header() {
  const { user, logout } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()

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

  // Direct log-out affordance — the old dropdown (change password / sign out)
  // was replaced by: change-password button inside Settings → Profile, and
  // this header button only logs out.
  const handleLogout = async () => {
    await unsubscribeFromPush().catch(() => {})
    logout()
    navigate('/login')
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
        <button
          type="button"
          className={s.userBtn}
          onClick={handleLogout}
          aria-label={t('header.signOut')}
          title={t('header.signOut')}
        >
          <Icon name="log-out" />
        </button>
      </div>
    </header>
  )
}
