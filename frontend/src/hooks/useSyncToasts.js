import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../components/useToast'
import { subscribeSyncEvents } from '../offline/sync'

/**
 * Surfaces drain outcomes as toasts. Mounted once from `App.jsx`.
 *
 *   - `drain-complete` with `successCount > 0` → transient success toast:
 *     "N changes synced" (short, informative).
 *   - `drain-complete` with `errorCount > 0`   → sticky error toast that
 *     links to the PendingBadge panel via a `window.dispatchEvent(new
 *     CustomEvent('open-pending-badge'))` — PendingBadge listens for it.
 */
export function useSyncToasts() {
  const { t } = useTranslation()
  const { showToast } = useToast()

  useEffect(() => {
    return subscribeSyncEvents((event) => {
      const { type, successCount = 0, errorCount = 0 } = event.detail ?? {}
      if (type !== 'drain-complete') return

      if (successCount > 0) {
        showToast({
          type: 'success',
          message: t('offline.synced', { count: successCount }),
          duration: 2000,
        })
      }
      if (errorCount > 0) {
        showToast({
          type: 'error',
          message: t('offline.syncErrors'),
          duration: 0,
          action: {
            label: t('offline.viewDetails'),
            onClick: () => {
              window.dispatchEvent(new CustomEvent('open-pending-badge'))
            },
          },
        })
      }
    })
  }, [t, showToast])
}
