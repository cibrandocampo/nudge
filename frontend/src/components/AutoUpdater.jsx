import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAppVersion } from '../contexts/AppVersionContext'
import { forceReload } from '../utils/forceReload'

const SAFE_ROUTES = new Set(['/', '/inventory', '/history', '/settings'])

// Headless component. Reloads the app silently when:
//   1. The bundle is stale (X-App-Version differs from VITE_APP_VERSION).
//   2. The user navigates TO a main route (BottomNav target).
// Modal opens, form edits, and idle time on a route do NOT generate
// navigation events, so they cannot trigger an unwanted reload mid-input.
export default function AutoUpdater() {
  const { updateAvailable } = useAppVersion()
  const location = useLocation()
  // Read the flag through a ref so the effect's deps stay limited to the
  // navigation key. If `updateAvailable` were a dep, the effect would
  // also fire when the flag flips while the user is parked on a safe
  // route — reloading on top of an open modal or in-flight form.
  const updateRef = useRef(updateAvailable)
  updateRef.current = updateAvailable

  useEffect(() => {
    if (updateRef.current && SAFE_ROUTES.has(location.pathname)) {
      forceReload()
    }
    // Intentional: deps limited to navigation events. See comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  return null
}
