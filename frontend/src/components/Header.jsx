import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import cx from '../utils/cx'
import ChangePasswordModal from './ChangePasswordModal'
import s from './Header.module.css'

export default function Header() {
  const { user, logout } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [showPwModal, setShowPwModal] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

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

  const handleLogout = () => {
    setMenuOpen(false)
    logout()
    navigate('/login')
  }

  return (
    <header className={s.header}>
      <span className={s.logo}>Nudge</span>
      <div className={s.right}>
        {user?.is_staff && (
          <button className={s.adminBtn} onClick={goToAdmin} title="Django admin panel">
            {t('header.admin', 'Admin')}
          </button>
        )}
        <div className={s.userWrap} ref={menuRef}>
          <button className={s.userBtn} onClick={() => setMenuOpen((v) => !v)}>
            {user?.username} <span className={s.chevron}>▾</span>
          </button>
          {menuOpen && (
            <div className={s.dropdown}>
              <button
                className={s.dropItem}
                onClick={() => {
                  setShowPwModal(true)
                  setMenuOpen(false)
                }}
              >
                {t('header.changePassword')}
              </button>
              <button className={cx(s.dropItem, s.dropItemDanger)} onClick={handleLogout}>
                {t('header.signOut')}
              </button>
            </div>
          )}
        </div>
      </div>
      {showPwModal && <ChangePasswordModal onClose={() => setShowPwModal(false)} />}
    </header>
  )
}
