import { Outlet, NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import cx from '../utils/cx'
import { usePushStatus } from '../hooks/usePushStatus'
import AlertBanner from './AlertBanner'
import Header from './Header'
import Icon from './Icon'
import shared from '../styles/shared.module.css'
import s from './Layout.module.css'

export default function Layout() {
  const { active } = usePushStatus()
  const { t } = useTranslation()

  const NAV = [
    { to: '/', icon: 'nav-dashboard', label: t('nav.home'), end: true },
    { to: '/inventory', icon: 'nav-inventory', label: t('nav.inventory'), end: false },
    { to: '/history', icon: 'nav-history', label: t('nav.history'), end: false },
    { to: '/settings', icon: 'nav-settings', label: t('nav.settings'), end: false },
  ]

  return (
    <div className={s.root}>
      <Header />
      {!active && (
        <AlertBanner variant="warning" icon="alert-triangle">
          {t('settings.pushAlert')}
        </AlertBanner>
      )}
      <main className={s.main}>
        <Outlet />
      </main>
      <nav className={s.nav}>
        {NAV.map(({ to, icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            aria-label={label}
            className={({ isActive }) => cx(s.link, isActive && s.linkActive)}
          >
            <span className={s.linkInner}>
              <Icon name={icon} size="lg" />
              <span className={s.navLabel}>{label}</span>
              {to === '/settings' && !active && (
                <span className={cx(shared.dot, shared.dotBrand, s.badge)} aria-hidden="true" />
              )}
            </span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
