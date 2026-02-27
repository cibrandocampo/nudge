import { useEffect, useState } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Home, History, Package, Settings } from 'lucide-react'
import cx from '../utils/cx'
import Header from './Header'
import s from './Layout.module.css'

function usePushOk() {
  const [ok, setOk] = useState(!('Notification' in window) || Notification.permission === 'granted')
  useEffect(() => {
    const check = () => setOk(!('Notification' in window) || Notification.permission === 'granted')
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [])
  return ok
}

export default function Layout() {
  const pushOk = usePushOk()
  const { t } = useTranslation()

  const NAV = [
    { to: '/', icon: Home, label: t('nav.home'), end: true },
    { to: '/inventory', icon: Package, label: t('nav.inventory'), end: false },
    { to: '/history', icon: History, label: t('nav.history'), end: false },
    { to: '/settings', icon: Settings, label: t('nav.settings'), end: false },
  ]

  return (
    <div className={s.root}>
      <Header />
      <main className={s.main}>
        <Outlet />
      </main>
      <nav className={s.nav}>
        {NAV.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            aria-label={label}
            className={({ isActive }) => cx(s.link, isActive && s.linkActive)}
          >
            <span className={s.linkInner}>
              <Icon size={20} strokeWidth={1.75} />
              <span className={s.navLabel}>{label}</span>
              {to === '/settings' && !pushOk && <span className={s.badge} />}
            </span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
