/**
 * PWA install prompt — detection helpers + event capture singleton.
 *
 * The two browser events we care about (`beforeinstallprompt` and
 * `appinstalled`) can fire at any time after page load, often before any UI
 * mounts. We register listeners at module-import time so the event is
 * captured regardless of when React renders, and dispatch namespaced
 * `nudge:install-*` CustomEvents so the React hook can re-render reactively.
 *
 * Public API:
 *   isStandalone()           — already running as installed PWA?
 *   isMobile()               — Android, iOS, or iPadOS device?
 *   getPlatform()            — 'ios' | 'android-chromium' | 'firefox-android' | 'other'
 *   hasNativePrompt()        — `beforeinstallprompt` was captured?
 *   isInstalledThisSession() — user installed during this page lifetime?
 *   triggerNativePrompt()    — fire the captured prompt; resolves with userChoice.
 */

let _installEvent = null
let _installedThisSession = false

function _onBeforeInstallPrompt(e) {
  e.preventDefault()
  _installEvent = e
  window.dispatchEvent(new CustomEvent('nudge:install-prompt-ready'))
}

function _onAppInstalled() {
  _installedThisSession = true
  _installEvent = null
  window.dispatchEvent(new CustomEvent('nudge:install-completed'))
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', _onBeforeInstallPrompt)
  window.addEventListener('appinstalled', _onAppInstalled)
}

export function isStandalone() {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  if (window.navigator?.standalone === true) return true
  return false
}

export function isMobile() {
  if (typeof navigator === 'undefined') return false
  if (navigator.userAgentData?.mobile === true) return true
  const ua = navigator.userAgent || ''
  if (/Android|iPhone|iPod/i.test(ua)) return true
  // iPadOS post-iOS13 reports as Macintosh; touch points reveal the truth.
  if (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1) return true
  return false
}

export function getPlatform() {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1) return 'ios'
  if (/Android/i.test(ua) && /Firefox/i.test(ua)) return 'firefox-android'
  if (/Android/i.test(ua)) return 'android-chromium'
  return 'other'
}

export function hasNativePrompt() {
  return _installEvent !== null
}

export function isInstalledThisSession() {
  return _installedThisSession
}

export async function triggerNativePrompt() {
  if (!_installEvent) {
    throw new Error('No captured beforeinstallprompt event to trigger.')
  }
  const event = _installEvent
  _installEvent = null
  await event.prompt()
  return event.userChoice
}

export function __resetForTests() {
  if (!import.meta.env.DEV) return
  _installEvent = null
  _installedThisSession = false
}
