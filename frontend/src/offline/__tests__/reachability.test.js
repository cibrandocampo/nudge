import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `reachability` imports `forceSync` from `./sync`. The real module boots
// the sync worker (window listeners, IDB access) — mock it so the suite
// stays hermetic and we can assert on the drain trigger.
const forceSyncMock = vi.fn()
vi.mock('../sync', () => ({
  forceSync: (...args) => forceSyncMock(...args),
}))

import { HEALTH_POLL_INTERVAL_MS, __resetForTests, getReachable, setReachable, subscribe } from '../reachability'

describe('offline/reachability', () => {
  let fetchSpy

  beforeEach(() => {
    vi.useFakeTimers()
    forceSyncMock.mockReset()
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    __resetForTests()
    vi.useRealTimers()
  })

  it('starts reachable', () => {
    expect(getReachable()).toBe(true)
  })

  it('setReachable(false) flips state and notifies subscribers', () => {
    const listener = vi.fn()
    subscribe(listener)
    setReachable(false)
    expect(getReachable()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('setReachable(value) is idempotent when value is already current', () => {
    const listener = vi.fn()
    subscribe(listener)
    setReachable(true) // already true
    expect(listener).not.toHaveBeenCalled()
  })

  it('starts a health poll only when flipping to false and stops it on true', async () => {
    expect(fetchSpy).not.toHaveBeenCalled()

    setReachable(false)
    // Poll has been scheduled but not yet fired — the first tick is one interval in.
    await vi.advanceTimersByTimeAsync(HEALTH_POLL_INTERVAL_MS)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const firstCallArgs = fetchSpy.mock.calls[0]
    expect(firstCallArgs[0]).toMatch(/\/api\/health\/$/)

    // After the 200 lands, the module flips back to true itself.
    await vi.runOnlyPendingTimersAsync()
    expect(getReachable()).toBe(true)

    // No more polls once we're reachable again.
    await vi.advanceTimersByTimeAsync(HEALTH_POLL_INTERVAL_MS * 2)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('two setReachable(false) calls do not duplicate the poll timer', async () => {
    setReachable(false)
    setReachable(false)
    await vi.advanceTimersByTimeAsync(HEALTH_POLL_INTERVAL_MS)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('passive setReachable(true) does NOT trigger forceSync — only the poll does', () => {
    setReachable(false)
    expect(forceSyncMock).not.toHaveBeenCalled()
    // A passive recovery (e.g. a user action succeeded) flips state but
    // must not start a drain concurrently with the in-flight request.
    setReachable(true)
    expect(forceSyncMock).not.toHaveBeenCalled()
  })

  it('health poll recovery triggers forceSync', async () => {
    setReachable(false)
    await vi.advanceTimersByTimeAsync(HEALTH_POLL_INTERVAL_MS)
    await vi.runOnlyPendingTimersAsync()
    expect(getReachable()).toBe(true)
    expect(forceSyncMock).toHaveBeenCalledTimes(1)
  })

  it('keeps polling while health check returns errors', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 503 }))
    setReachable(false)

    await vi.advanceTimersByTimeAsync(HEALTH_POLL_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(HEALTH_POLL_INTERVAL_MS)

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(getReachable()).toBe(false)
  })

  it('keeps polling when fetch rejects (network error)', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'))
    setReachable(false)

    await vi.advanceTimersByTimeAsync(HEALTH_POLL_INTERVAL_MS)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(getReachable()).toBe(false)
  })

  it('unsubscribe removes the listener', () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    unsubscribe()
    setReachable(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('__NUDGE_REACHABILITY_LOCK__ blocks setReachable side effects', () => {
    const listener = vi.fn()
    subscribe(listener)
    window.__NUDGE_REACHABILITY_LOCK__ = true
    setReachable(false)
    expect(getReachable()).toBe(true)
    expect(listener).not.toHaveBeenCalled()
    delete window.__NUDGE_REACHABILITY_LOCK__
  })

  it('refuses to flip to true while navigator reports offline', () => {
    const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      setReachable(false)
      expect(getReachable()).toBe(false)
      // Passive setReachable(true) must be ignored while the native flag is offline.
      setReachable(true)
      expect(getReachable()).toBe(false)
    } finally {
      onLineSpy.mockRestore()
    }
  })
})
