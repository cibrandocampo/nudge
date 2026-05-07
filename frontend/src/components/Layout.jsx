import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import cx from '../utils/cx'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { usePushStatus } from '../hooks/usePushStatus'
import { useRoutines } from '../hooks/useRoutines'
import { useServerReachable } from '../hooks/useServerReachable'
import AlertBanner from './AlertBanner'
import AutoUpdater from './AutoUpdater'
import Header from './Header'
import Icon from './Icon'
import InstallBanner from './InstallBanner'
import OfflineBanner from './OfflineBanner'
import { useToast } from './useToast'
import shared from '../styles/shared.module.css'
import s from './Layout.module.css'

// Routes that are locked while the backend is unreachable. The route
// guard in App.jsx handles the swap to <OfflineLockedPlaceholder>;
// here we mirror the policy in the BottomNav so the user sees the
// item disabled BEFORE clicking. Defence in depth — if either layer
// missed a route, the other catches it.
const LOCKED_OFFLINE_ROUTES = new Set(['/history', '/settings'])

export default function Layout() {
  const { active } = usePushStatus()
  const { canInstall } = useInstallPrompt()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: routines = [] } = useRoutines()
  const hasPendingRoutines = routines.some((r) => r.is_due)
  const reachable = useServerReachable()
  const { showToast } = useToast()

  const NAV = [
    {
      to: '/',
      icon: hasPendingRoutines ? 'badge-alert' : 'badge',
      label: t('nav.home'),
      end: true,
    },
    { to: '/inventory', icon: 'nav-inventory', label: t('nav.inventory'), end: false },
    { to: '/history', icon: 'nav-history', label: t('nav.history'), end: false },
    { to: '/settings', icon: 'nav-settings', label: t('nav.settings'), end: false },
  ]

  const renderInner = (icon, label, to) => (
    <span className={s.linkInner}>
      <Icon name={icon} size="lg" />
      <span className={s.navLabel}>{label}</span>
      {to === '/settings' && !active && (
        <span className={cx(shared.dot, shared.dotBrand, s.badge)} aria-hidden="true" />
      )}
      {to === '/' && hasPendingRoutines && (
        <span className={cx(shared.dot, shared.dotBrand, s.badge)} aria-hidden="true" />
      )}
    </span>
  )

  return (
    <div className={s.root}>
      <AutoUpdater />
      <Header />
      <InstallBanner />
      <OfflineBanner />
      {!canInstall && !active && (
        <AlertBanner variant="warning" icon="alert-triangle" onClick={() => navigate('/settings#push')}>
          {t('settings.pushAlert')}
        </AlertBanner>
      )}
      <main className={s.main}>
        <Outlet />
      </main>
      <nav className={s.nav}>
        {NAV.map(({ to, icon, label, end }) => {
          const isLocked = !reachable && LOCKED_OFFLINE_ROUTES.has(to)
          if (isLocked) {
            return (
              <button
                key={to}
                type="button"
                aria-label={label}
                aria-disabled="true"
                title={t('offline.requiresConnection')}
                className={cx(s.link, shared.disabled)}
                onClick={() => showToast({ type: 'error', message: t('offline.pageUnavailable') })}
              >
                {renderInner(icon, label, to)}
              </button>
            )
          }
          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={label}
              className={({ isActive }) => cx(s.link, isActive && s.linkActive)}
            >
              {renderInner(icon, label, to)}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}
