// The install banner's ×, remembered per device (T155, UX-009): installing is
// a fact about this device, not about the profile, so it lives in
// localStorage, not on the server. Settings' InstallCard ignores it — install
// stays reachable there.
const KEY = 'nudge.installDismissed'

export function isInstallDismissed() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function dismissInstall() {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // Storage unavailable (private mode quota): the banner simply comes back
    // next visit, which is harmless.
  }
}
