import { useLayoutEffect } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
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
import buttons from '../styles/buttons.module.css'
import cards from '../styles/cards.module.css'
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
  const { pathname } = useLocation()

  // A new page opens at its top. The browser keeps the window's offset across
  // client-side navigation, so a page opened from far down a list would land
  // part-way down, and keep sliding while its later sections load. The
  // inventory is left alone: it restores its own offset, and this effect, a
  // parent's, runs after the page's and would undo it.
  useLayoutEffect(() => {
    if (pathname === '/inventory' || window.scrollY === 0) return
    window.scrollTo(0, 0)
  }, [pathname])

  // Pending routines show as the brand dot on the icon, not as a different
  // icon (T105).
  const NAV = [
    { to: '/', icon: 'list-checks', label: t('nav.home'), end: true },
    { to: '/inventory', icon: 'nav-inventory', label: t('nav.inventory'), end: false },
    { to: '/history', icon: 'history', label: t('nav.history'), end: false },
    { to: '/settings', icon: 'nav-settings', label: t('nav.settings'), end: false },
  ]

  // The dots hang off `iconWrap`, not `linkInner`: the label can be wider
  // than the icon, and the dot belongs on the icon's corner at either size.
  const renderInner = (icon, label, to) => (
    <span className={s.linkInner}>
      <span className={s.iconWrap}>
        <Icon name={icon} size="lg" />
        {to === '/settings' && !active && (
          <span className={cx(cards.dot, cards.dotBrand, s.badge)} aria-hidden="true" />
        )}
        {to === '/' && hasPendingRoutines && (
          <span className={cx(cards.dot, cards.dotBrand, s.badge)} aria-hidden="true" />
        )}
      </span>
      <span className={s.navLabel}>{label}</span>
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
                className={cx(s.link, buttons.disabled)}
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
