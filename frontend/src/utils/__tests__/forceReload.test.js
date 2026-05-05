import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forceReload } from '../forceReload'

describe('forceReload', () => {
  let originalLocation
  let originalCaches
  let originalServiceWorker
  let reloadSpy

  beforeEach(() => {
    originalLocation = window.location
    originalCaches = window.caches
    originalServiceWorker = navigator.serviceWorker
    reloadSpy = vi.fn()
    delete window.location
    window.location = { reload: reloadSpy, href: 'http://localhost/' }
  })

  afterEach(() => {
    window.location = originalLocation
    if (originalCaches === undefined) {
      delete window.caches
    } else {
      window.caches = originalCaches
    }
    // setup.js declared navigator.serviceWorker as writable: true (not
    // configurable), so direct assignment is the only way to reset it.
    navigator.serviceWorker = originalServiceWorker
    vi.restoreAllMocks()
  })

  it('deletes every Cache Storage entry then reloads', async () => {
    const deleteSpy = vi.fn().mockResolvedValue(true)
    window.caches = {
      keys: vi.fn().mockResolvedValue(['cache-a', 'cache-b']),
      delete: deleteSpy,
    }

    await forceReload()

    expect(window.caches.keys).toHaveBeenCalledTimes(1)
    expect(deleteSpy).toHaveBeenCalledTimes(2)
    expect(deleteSpy).toHaveBeenCalledWith('cache-a')
    expect(deleteSpy).toHaveBeenCalledWith('cache-b')
    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })

  it('does not unregister the Service Worker (preserves push subscription)', async () => {
    window.caches = { keys: vi.fn().mockResolvedValue([]), delete: vi.fn() }
    const unregisterSpy = vi.fn().mockResolvedValue(true)
    const getRegistrationSpy = vi.fn().mockResolvedValue({ unregister: unregisterSpy })
    navigator.serviceWorker = { getRegistration: getRegistrationSpy }

    await forceReload()

    expect(getRegistrationSpy).not.toHaveBeenCalled()
    expect(unregisterSpy).not.toHaveBeenCalled()
    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })

  it('still reloads when the Cache API is missing', async () => {
    delete window.caches

    await forceReload()

    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })

  it('still reloads when caches.keys() rejects', async () => {
    window.caches = {
      keys: vi.fn().mockRejectedValue(new Error('denied')),
      delete: vi.fn(),
    }

    await forceReload()

    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })
})
