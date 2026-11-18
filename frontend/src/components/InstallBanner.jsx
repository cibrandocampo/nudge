import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { useServerReachable } from '../hooks/useServerReachable'
import Icon from './Icon'
import InstallSheet from './InstallSheet'
import s from './InstallBanner.module.css'

/**
 * Sticky top banner inviting the user to install Nudge as a PWA. Auto-hides
 * when running in standalone mode, on desktop, or after the user installs
 * during this session — see `useInstallPrompt`.
 *
 * Also hidden while the server is unreachable: the offline banner sticks to
 * the same spot and is the one that matters then (both stuck at once, the
 * install invitation covered it, UX-042).
 */
export default function InstallBanner() {
  const { t } = useTranslation()
  const { canInstall, hasNativePrompt, platform, triggerNativePrompt } = useInstallPrompt()
  const reachable = useServerReachable()
  const [sheetOpen, setSheetOpen] = useState(false)

  if (!canInstall || !reachable) return null

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
      <button type="button" className={s.banner} onClick={handleClick} data-testid="install-banner">
        <img src="/icons/source.svg" alt="" className={s.logo} aria-hidden="true" />
        <span>{t('pwa.install.banner')}</span>
        <Icon name="chevron-right" size="sm" />
      </button>
      {sheetOpen && <InstallSheet platform={platform} onClose={() => setSheetOpen(false)} />}
    </>
  )
}
