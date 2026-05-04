import { useEffect, useState } from 'react'
import {
  getPlatform,
  hasNativePrompt,
  isInstalledThisSession,
  isMobile,
  isStandalone,
  triggerNativePrompt,
} from '../utils/installPrompt'

/**
 * React hook over the install-prompt singleton. Subscribes to the namespaced
 * `nudge:install-*` events so consumers re-render when `beforeinstallprompt`
 * is captured (often after mount) or when the user completes installation
 * during the current session.
 *
 * Returns `{ canInstall, platform, hasNativePrompt, triggerNativePrompt }`.
 * The consumer decides whether to call `triggerNativePrompt` (when
 * `hasNativePrompt === true`) or to open an instructional sheet — the hook
 * holds no UI state.
 */
export function useInstallPrompt() {
  const [, setVersion] = useState(0)

  useEffect(() => {
    const onUpdate = () => setVersion((v) => v + 1)
    window.addEventListener('nudge:install-prompt-ready', onUpdate)
    window.addEventListener('nudge:install-completed', onUpdate)
    return () => {
      window.removeEventListener('nudge:install-prompt-ready', onUpdate)
      window.removeEventListener('nudge:install-completed', onUpdate)
    }
  }, [])

  const canInstall = isMobile() && !isStandalone() && !isInstalledThisSession()

  return {
    canInstall,
    platform: getPlatform(),
    hasNativePrompt: hasNativePrompt(),
    triggerNativePrompt,
  }
}
