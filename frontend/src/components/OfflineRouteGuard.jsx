import { useServerReachable } from '../hooks/useServerReachable'
import OfflineLockedPlaceholder from './OfflineLockedPlaceholder'

/**
 * Route-level offline gate. Renders ``children`` while the backend is
 * reachable; swaps to ``<OfflineLockedPlaceholder>`` while it isn't.
 *
 * Used to wrap routes whose actions are not queueable (settings save,
 * password change, push subscribe) or whose UX assumes fresh server
 * data (history with paginated fetches). The user gets a clear "not
 * available offline" page instead of a half-broken view.
 *
 * The guard subscribes to reachability via ``useServerReachable``, so
 * a flip in either direction re-renders the wrapped subtree
 * automatically — no extra effect or navigation needed.
 */
export default function OfflineRouteGuard({ children }) {
  const reachable = useServerReachable()
  if (!reachable) return <OfflineLockedPlaceholder />
  return children
}
