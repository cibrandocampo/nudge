import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { useServerReachable } from '../hooks/useServerReachable'
import InstallSheet from './InstallSheet'
import Notice from './Notice'

/**
 * The invitation to install Nudge as a PWA, in the notice slot (T155). Hidden
 * when running standalone, on desktop, or after installing this session (see
 * `useInstallPrompt`), and while offline (the offline notice is the one that
 * matters then, UX-042).
 *
 * Its × hides it for good on this device (UX-009): `NoticeSlot` remembers it
 * (`utils/installDismissal`) and stops rendering this, since whether install
 * shows decides whether the notifications notice may. Settings' InstallCard
 * still offers installing.
 *
 * Props:
 *   onDismiss — the × was pressed
 */
export default function InstallBanner({ onDismiss }) {
  const { t } = useTranslation()
  const { canInstall, hasNativePrompt, platform, triggerNativePrompt } = useInstallPrompt()
  const reachable = useServerReachable()
  const [sheetOpen, setSheetOpen] = useState(false)

  // The sheet outlives the notice: it stays open while the user follows it.
  if ((!canInstall || !reachable) && !sheetOpen) return null

  const handleClick = async () => {
    if (hasNativePrompt) {
      try {
        await triggerNativePrompt()
        return
      } catch {
        // Captured event already consumed or rejected — fall back to instructions.
      }
    }
    setSheetOpen(true)
  }

  return (
    <>
      {canInstall && reachable && (
        <Notice
          tone="neutral"
          icon="download"
          onClick={handleClick}
          onDismiss={onDismiss}
          dismissLabel={t('pwa.install.dismiss')}
          testId="install-notice"
          actionTestId="install-banner"
          dismissTestId="install-dismiss"
        >
          {t('pwa.install.banner')}
        </Notice>
      )}
      {sheetOpen && <InstallSheet platform={platform} onClose={() => setSheetOpen(false)} />}
    </>
  )
}
