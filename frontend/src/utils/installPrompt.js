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
 *   waitForNativePrompt()    — is a prompt available, waiting briefly for it where one can come?
 *   triggerNativePrompt()    — fire the captured prompt; resolves with userChoice.
 */

const NATIVE_PROMPT_WAIT_MS = 1500

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

/**
 * Chrome can deliver `beforeinstallprompt` after the first tap, and again
 * shortly after the user cancels its dialog. On Android Chromium in a secure
 * context, wait a moment rather than fall back to manual instructions; the
 * tap's user activation outlasts the wait, so `prompt()` is still allowed.
 * Elsewhere the event never comes, so answer at once.
 */
export function waitForNativePrompt(timeoutMs = NATIVE_PROMPT_WAIT_MS) {
  if (_installEvent) return Promise.resolve(true)
  if (getPlatform() !== 'android-chromium' || !window.isSecureContext) return Promise.resolve(false)
  return new Promise((resolve) => {
    const finish = (ready) => {
      clearTimeout(timer)
      window.removeEventListener('nudge:install-prompt-ready', onReady)
      resolve(ready)
    }
    const onReady = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    window.addEventListener('nudge:install-prompt-ready', onReady)
  })
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
