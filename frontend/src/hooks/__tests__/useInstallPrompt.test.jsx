import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetForTests } from '../../utils/installPrompt'
import { useInstallPrompt } from '../useInstallPrompt'

const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const UA_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function setNavigator({ userAgent, maxTouchPoints = 0, standalone, userAgentData } = {}) {
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

beforeEach(() => {
  __resetForTests()
  setMatchMedia(() => false)
})

describe('useInstallPrompt', () => {
  it('returns canInstall=false on desktop UA', () => {
    setNavigator({ userAgent: UA_DESKTOP })
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.canInstall).toBe(false)
  })

  it('returns canInstall=true on mobile + not standalone', () => {
    setNavigator({ userAgent: UA_IPHONE })
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.canInstall).toBe(true)
    expect(result.current.platform).toBe('ios')
  })

  it('returns canInstall=false when running in standalone mode', () => {
    setNavigator({ userAgent: UA_IPHONE, standalone: true })
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.canInstall).toBe(false)
  })

  it('re-renders when nudge:install-prompt-ready fires (hasNativePrompt flips)', () => {
    setNavigator({ userAgent: UA_IPHONE })
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.hasNativePrompt).toBe(false)

    act(() => {
      const evt = new Event('beforeinstallprompt')
      evt.prompt = vi.fn().mockResolvedValue(undefined)
      evt.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' })
      window.dispatchEvent(evt)
    })

    expect(result.current.hasNativePrompt).toBe(true)
  })

  it('re-renders when nudge:install-completed fires (canInstall flips false)', () => {
    setNavigator({ userAgent: UA_IPHONE })
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.canInstall).toBe(true)

    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })

    expect(result.current.canInstall).toBe(false)
  })
})
