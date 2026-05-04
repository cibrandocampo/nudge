import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetForTests,
  getPlatform,
  hasNativePrompt,
  isInstalledThisSession,
  isMobile,
  isStandalone,
  triggerNativePrompt,
} from '../installPrompt'

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ipadAsMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 13; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0',
  samsungAndroid:
    'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/22.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
}

function setNavigator({ userAgent, userAgentData, maxTouchPoints = 0, standalone } = {}) {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true })
  Object.defineProperty(navigator, 'userAgentData', { value: userAgentData, configurable: true })
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true })
  Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true })
}

function setMatchMedia(matchesFn) {
  window.matchMedia = vi.fn((query) => ({
    matches: matchesFn ? matchesFn(query) : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  }))
}

function fireBeforeInstallPrompt({ outcome = 'accepted', platform = 'web' } = {}) {
  const evt = new Event('beforeinstallprompt')
  evt.prompt = vi.fn().mockResolvedValue(undefined)
  evt.userChoice = Promise.resolve({ outcome, platform })
  window.dispatchEvent(evt)
  return evt
}

beforeEach(() => {
  __resetForTests()
  setNavigator({ userAgent: UA.windowsChrome, userAgentData: undefined, maxTouchPoints: 0, standalone: undefined })
  setMatchMedia(() => false)
})

describe('isStandalone', () => {
  it('returns true when matchMedia matches display-mode: standalone', () => {
    setMatchMedia((q) => q.includes('display-mode: standalone'))
    expect(isStandalone()).toBe(true)
  })

  it('returns true when navigator.standalone is true (iOS Safari)', () => {
    setNavigator({ userAgent: UA.iphone, standalone: true })
    expect(isStandalone()).toBe(true)
  })

  it('returns false in normal conditions', () => {
    expect(isStandalone()).toBe(false)
  })
})

describe('isMobile', () => {
  it('true for iPhone UA', () => {
    setNavigator({ userAgent: UA.iphone })
    expect(isMobile()).toBe(true)
  })

  it('true for Android Chrome UA', () => {
    setNavigator({ userAgent: UA.androidChrome })
    expect(isMobile()).toBe(true)
  })

  it('true for Firefox Android UA', () => {
    setNavigator({ userAgent: UA.firefoxAndroid })
    expect(isMobile()).toBe(true)
  })

  it('true for iPadOS reporting as Macintosh + maxTouchPoints>1', () => {
    setNavigator({ userAgent: UA.ipadAsMac, maxTouchPoints: 5 })
    expect(isMobile()).toBe(true)
  })

  it('false for real Macintosh + maxTouchPoints=0', () => {
    setNavigator({ userAgent: UA.macSafari, maxTouchPoints: 0 })
    expect(isMobile()).toBe(false)
  })

  it('false for Windows Chrome', () => {
    setNavigator({ userAgent: UA.windowsChrome })
    expect(isMobile()).toBe(false)
  })

  it('true when navigator.userAgentData.mobile is true', () => {
    setNavigator({ userAgent: UA.windowsChrome, userAgentData: { mobile: true } })
    expect(isMobile()).toBe(true)
  })
})

describe('getPlatform', () => {
  it("returns 'ios' for iPhone UA", () => {
    setNavigator({ userAgent: UA.iphone })
    expect(getPlatform()).toBe('ios')
  })

  it("returns 'ios' for iPadOS reporting as Macintosh + touch", () => {
    setNavigator({ userAgent: UA.ipadAsMac, maxTouchPoints: 5 })
    expect(getPlatform()).toBe('ios')
  })

  it("returns 'firefox-android' for Firefox on Android", () => {
    setNavigator({ userAgent: UA.firefoxAndroid })
    expect(getPlatform()).toBe('firefox-android')
  })

  it("returns 'android-chromium' for Chrome on Android", () => {
    setNavigator({ userAgent: UA.androidChrome })
    expect(getPlatform()).toBe('android-chromium')
  })

  it("returns 'android-chromium' for Samsung Internet", () => {
    setNavigator({ userAgent: UA.samsungAndroid })
    expect(getPlatform()).toBe('android-chromium')
  })

  it("returns 'other' for desktop UA", () => {
    setNavigator({ userAgent: UA.windowsChrome })
    expect(getPlatform()).toBe('other')
  })
})

describe('beforeinstallprompt capture', () => {
  it('hasNativePrompt() flips to true after the event fires', () => {
    expect(hasNativePrompt()).toBe(false)
    fireBeforeInstallPrompt()
    expect(hasNativePrompt()).toBe(true)
  })

  it('triggerNativePrompt() invokes prompt() and resolves with userChoice', async () => {
    const evt = fireBeforeInstallPrompt({ outcome: 'accepted', platform: 'web' })

    const choice = await triggerNativePrompt()

    expect(evt.prompt).toHaveBeenCalledTimes(1)
    expect(choice).toEqual({ outcome: 'accepted', platform: 'web' })
  })

  it('triggerNativePrompt() throws when no event was captured', async () => {
    await expect(triggerNativePrompt()).rejects.toThrow(/No captured beforeinstallprompt/)
  })

  it('appinstalled flips installedThisSession and clears the captured event', () => {
    fireBeforeInstallPrompt()
    expect(hasNativePrompt()).toBe(true)
    expect(isInstalledThisSession()).toBe(false)

    window.dispatchEvent(new Event('appinstalled'))

    expect(isInstalledThisSession()).toBe(true)
    expect(hasNativePrompt()).toBe(false)
  })
})
