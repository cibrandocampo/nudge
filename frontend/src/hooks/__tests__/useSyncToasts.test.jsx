import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

// Capture the subscribe callback so tests can emit synthetic sync events.
let capturedListener = null
const unsubscribe = vi.fn()
vi.mock('../../offline/sync', () => ({
  subscribeSyncEvents: (listener) => {
    capturedListener = listener
    return unsubscribe
  },
}))

// Mock the toast hook; each test resets it.
const showToast = vi.fn()
vi.mock('../../components/useToast', () => ({
  useToast: () => ({ showToast }),
}))

// Mock react-i18next so `t(key, vars)` returns a deterministic string — the
// test asserts on the toast payload, not the translation.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
  }),
}))

import { useSyncToasts } from '../useSyncToasts'

describe('useSyncToasts', () => {
  beforeEach(() => {
    capturedListener = null
    showToast.mockReset()
    unsubscribe.mockReset()
  })

  it('subscribes on mount and unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useSyncToasts())
    expect(typeof capturedListener).toBe('function')
    expect(unsubscribe).not.toHaveBeenCalled()
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('shows a transient success toast when successCount > 0', () => {
    renderHook(() => useSyncToasts())
    act(() => {
      capturedListener({ detail: { type: 'drain-complete', successCount: 3, errorCount: 0 } })
    })
    expect(showToast).toHaveBeenCalledTimes(1)
    const call = showToast.mock.calls[0][0]
    expect(call.type).toBe('success')
    expect(call.message).toContain('offline.synced')
    expect(call.message).toContain('"count":3')
    expect(call.duration).toBe(2000)
  })

  it('shows a sticky error toast with an action that opens the pending badge', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    renderHook(() => useSyncToasts())
    act(() => {
      capturedListener({ detail: { type: 'drain-complete', successCount: 0, errorCount: 2 } })
    })
    const call = showToast.mock.calls[0][0]
    expect(call.type).toBe('error')
    expect(call.message).toBe('offline.syncErrors')
    expect(call.duration).toBe(0)
    expect(call.action.label).toBe('offline.viewDetails')

    call.action.onClick()
    const event = dispatchSpy.mock.calls.at(-1)[0]
    expect(event).toBeInstanceOf(CustomEvent)
    expect(event.type).toBe('open-pending-badge')
    dispatchSpy.mockRestore()
  })

  it('fires BOTH success and error toasts when the drain had a mixed outcome', () => {
    renderHook(() => useSyncToasts())
    act(() => {
      capturedListener({ detail: { type: 'drain-complete', successCount: 2, errorCount: 1 } })
    })
    expect(showToast).toHaveBeenCalledTimes(2)
    expect(showToast.mock.calls[0][0].type).toBe('success')
    expect(showToast.mock.calls[1][0].type).toBe('error')
  })

  it('ignores non drain-complete events', () => {
    renderHook(() => useSyncToasts())
    act(() => {
      capturedListener({ detail: { type: 'drain-start' } })
      capturedListener({ detail: { type: 'whatever', successCount: 5 } })
    })
    expect(showToast).not.toHaveBeenCalled()
  })

  it('is a no-op when event.detail is missing', () => {
    renderHook(() => useSyncToasts())
    act(() => {
      capturedListener({})
    })
    expect(showToast).not.toHaveBeenCalled()
  })
})
