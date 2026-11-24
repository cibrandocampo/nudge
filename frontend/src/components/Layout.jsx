import { useEffect, useLayoutEffect } from 'react'
import { Link, Outlet, matchPath, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import cx from '../utils/cx'
import { useKeyboardOpen } from '../hooks/useKeyboardOpen'
import { useRoutines } from '../hooks/useRoutines'
import { useServerReachable } from '../hooks/useServerReachable'
import AutoUpdater from './AutoUpdater'
import Header from './Header'
import Icon from './Icon'
import NoticeSlot from './NoticeSlot'
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
  const { t } = useTranslation()
  const { data: routines = [] } = useRoutines()
  const hasPendingRoutines = routines.some((r) => r.is_due)
  const reachable = useServerReachable()
  const { showToast } = useToast()
  const { pathname } = useLocation()
  const keyboardOpen = useKeyboardOpen()

  // On the root element, because `--nav-h` also places the toasts and the
  // page's scroll padding: with the bar hidden, none of them keeps its room.
  useEffect(() => {
    if (!keyboardOpen) return undefined
    document.documentElement.dataset.keyboard = 'open'
    return () => delete document.documentElement.dataset.keyboard
  }, [keyboardOpen])

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
  // `match`: the routes that belong to each tab, so a routine's or a product's
  // own screens keep their section marked.
  const NAV = [
    { to: '/', icon: 'list-checks', label: t('nav.home'), match: ['/', '/routines/*'] },
    { to: '/inventory', icon: 'nav-inventory', label: t('nav.inventory'), match: ['/inventory/*'] },
    { to: '/history', icon: 'history', label: t('nav.history'), match: ['/history/*'] },
    { to: '/settings', icon: 'nav-settings', label: t('nav.settings'), match: ['/settings/*'] },
  ]

  // The block is one element that slides between tabs. A locked tab cannot be
  // the current one, so it never sits under a disabled control.
  const activeTab = NAV.findIndex(
    ({ to, match }) => match.some((path) => matchPath(path, pathname)) && (reachable || !LOCKED_OFFLINE_ROUTES.has(to)),
  )

  // The dots hang off `iconWrap`, not `linkInner`: the label can be wider
  // than the icon, and the dot belongs on the icon's corner at either size.
  const renderInner = (icon, label, to) => (
    <span className={s.linkInner}>
      <span className={s.iconWrap}>
        <Icon name={icon} size="lg" className={s.iconLine} />
        <Icon name={`${icon}-fill`} size="lg" className={s.iconFill} />
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
      {/* One notice at a time: offline, unsaved changes, install, notifications (T155). */}
      <NoticeSlot />
      <main className={s.main}>
        <Outlet />
      </main>
      <nav className={s.nav}>
        <span
          className={cx(s.indicator, activeTab < 0 && s.indicatorHidden)}
          style={{ '--tab': Math.max(activeTab, 0) }}
          aria-hidden="true"
          data-testid="nav-indicator"
        />
        {NAV.map(({ to, icon, label }, index) => {
          const isLocked = !reachable && LOCKED_OFFLINE_ROUTES.has(to)
          if (isLocked) {
            return (
              <button
                key={to}
                type="button"
                aria-label={label}
                aria-disabled="true"
                title={t('offline.requiresConnection')}
                className={cx(s.link, buttons.disabledText)}
                onClick={() => showToast({ type: 'error', message: t('offline.pageUnavailable') })}
              >
                {renderInner(icon, label, to)}
              </button>
            )
          }
          return (
            <Link
              key={to}
              to={to}
              aria-label={label}
              aria-current={index === activeTab ? 'page' : undefined}
              className={cx(s.link, index === activeTab && s.linkActive)}
            >
              {renderInner(icon, label, to)}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
