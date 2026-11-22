import { useInstallPrompt } from './useInstallPrompt'
import { usePushStatus } from './usePushStatus'

/**
 * What this device still needs for reminders to work: installing the app and
 * turning notifications on. The notice that points here cannot be closed, so
 * an action only counts when the user can actually complete it:
 *   - notifications count where the browser supports them, on an iPhone that
 *     gets them by installing, and on plain HTTP, where the browser hides the
 *     API: the device still lacks them, so it must not read as «all done»;
 *   - with permission granted they wait for the subscription to be read, so a
 *     device with everything done never flashes the notice while loading.
 *
 * `pushState`: 'needs-https' | 'needs-install' (iPhone, install first) |
 * 'blocked' | 'ready'.
 */
export function pendingActions({ canInstall, platform }, { permission, subscribed, checked }) {
  const needsInstallFirst = canInstall && platform === 'ios'
  const pushSupported = typeof Notification !== 'undefined' && 'serviceWorker' in navigator
  const insecure = window.isSecureContext === false
  const push =
    insecure || ((pushSupported || needsInstallFirst) && (permission !== 'granted' || (checked && !subscribed)))

  let pushState = 'ready'
  if (insecure) pushState = 'needs-https'
  else if (needsInstallFirst) pushState = 'needs-install'
  else if (permission === 'denied') pushState = 'blocked'

  return { install: canInstall, push, pushState, count: Number(canInstall) + Number(push) }
}

export function usePendingActions() {
  return pendingActions(useInstallPrompt(), usePushStatus())
}
