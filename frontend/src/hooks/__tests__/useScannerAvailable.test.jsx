import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScannerAvailable } from '../useScannerAvailable'
import { WASM_CACHE_NAME, ZXING_WASM_URL } from '../../utils/wasmAsset'

const reachable = vi.fn()
vi.mock('../useServerReachable', () => ({
  useServerReachable: () => reachable(),
}))

function mockCaches({ cached }) {
  const match = vi.fn().mockResolvedValue(cached ? new Response('') : undefined)
  globalThis.caches = { open: vi.fn().mockResolvedValue({ match }) }
  return match
}

beforeEach(() => {
  vi.clearAllMocks()
  window.isSecureContext = true
  navigator.mediaDevices = { getUserMedia: vi.fn() }
  reachable.mockReturnValue(true)
  mockCaches({ cached: false })
})

afterEach(() => {
  delete navigator.mediaDevices
  delete globalThis.caches
})

describe('useScannerAvailable', () => {
  it('is false without a secure context', () => {
    window.isSecureContext = false
    const { result } = renderHook(() => useScannerAvailable())
    expect(result.current).toBe(false)
  })

  it('is false when the browser has no camera API', () => {
    delete navigator.mediaDevices
    const { result } = renderHook(() => useScannerAvailable())
    expect(result.current).toBe(false)
  })

  it('is true when secure and online', () => {
    const { result } = renderHook(() => useScannerAvailable())
    expect(result.current).toBe(true)
  })

  it('is true offline once the decoder has been cached', async () => {
    reachable.mockReturnValue(false)
    const match = mockCaches({ cached: true })
    const { result } = renderHook(() => useScannerAvailable())

    await waitFor(() => expect(result.current).toBe(true))
    expect(caches.open).toHaveBeenCalledWith(WASM_CACHE_NAME)
    expect(match).toHaveBeenCalledWith(ZXING_WASM_URL)
  })

  it('is false offline while the decoder has never been fetched', async () => {
    reachable.mockReturnValue(false)
    mockCaches({ cached: false })
    const { result } = renderHook(() => useScannerAvailable())

    await waitFor(() => expect(caches.open).toHaveBeenCalled())
    expect(result.current).toBe(false)
  })

  it('is false offline when the Cache API is unavailable', () => {
    reachable.mockReturnValue(false)
    delete globalThis.caches
    const { result } = renderHook(() => useScannerAvailable())
    expect(result.current).toBe(false)
  })

  it('survives a rejecting Cache API', async () => {
    reachable.mockReturnValue(false)
    globalThis.caches = { open: vi.fn().mockRejectedValue(new Error('nope')) }
    const { result } = renderHook(() => useScannerAvailable())

    await waitFor(() => expect(caches.open).toHaveBeenCalled())
    expect(result.current).toBe(false)
  })
})

describe('useScannerAvailable — is there a camera at all', () => {
  const device = (kind) => ({ kind, deviceId: kind, label: '' })

  it('is true when the browser lists a camera', async () => {
    navigator.mediaDevices.enumerateDevices = vi.fn().mockResolvedValue([device('audioinput'), device('videoinput')])
    const { result } = renderHook(() => useScannerAvailable())

    await waitFor(() => expect(navigator.mediaDevices.enumerateDevices).toHaveBeenCalled())
    expect(result.current).toBe(true)
  })

  it('is false when the browser lists no camera', async () => {
    navigator.mediaDevices.enumerateDevices = vi.fn().mockResolvedValue([device('audioinput')])
    const { result } = renderHook(() => useScannerAvailable())

    await waitFor(() => expect(result.current).toBe(false))
  })

  it('assumes a camera while the list is still on its way', async () => {
    let settle
    navigator.mediaDevices.enumerateDevices = vi.fn(
      () =>
        new Promise((resolve) => {
          settle = resolve
        }),
    )
    const { result } = renderHook(() => useScannerAvailable())
    expect(result.current).toBe(true)

    await waitFor(() => expect(navigator.mediaDevices.enumerateDevices).toHaveBeenCalled())
    expect(result.current).toBe(true)
    await act(async () => settle([]))
    expect(result.current).toBe(false)
  })

  it('assumes a camera when the browser cannot list devices', () => {
    // beforeEach installs a camera API without enumerateDevices.
    const { result } = renderHook(() => useScannerAvailable())
    expect(result.current).toBe(true)
  })

  it('assumes a camera when listing devices throws', async () => {
    navigator.mediaDevices.enumerateDevices = vi.fn(() => {
      throw new Error('nope')
    })
    const { result } = renderHook(() => useScannerAvailable())

    await waitFor(() => expect(navigator.mediaDevices.enumerateDevices).toHaveBeenCalled())
    await act(async () => {})
    expect(result.current).toBe(true)
  })

  it('assumes a camera when listing devices rejects', async () => {
    navigator.mediaDevices.enumerateDevices = vi.fn().mockRejectedValue(new Error('nope'))
    const { result } = renderHook(() => useScannerAvailable())

    await waitFor(() => expect(navigator.mediaDevices.enumerateDevices).toHaveBeenCalled())
    await act(async () => {})
    expect(result.current).toBe(true)
  })
})

describe('useScannerAvailable — answers that arrive after unmount', () => {
  function pending() {
    let settle
    const promise = new Promise((resolve) => {
      settle = resolve
    })
    return { promise, settle: (value) => settle(value) }
  }

  it('drops a camera list that arrives after unmount', async () => {
    const list = pending()
    navigator.mediaDevices.enumerateDevices = vi.fn(() => list.promise)
    const { result, unmount } = renderHook(() => useScannerAvailable())
    await waitFor(() => expect(navigator.mediaDevices.enumerateDevices).toHaveBeenCalled())

    unmount()
    await act(async () => list.settle([]))
    expect(result.current).toBe(true)
  })

  it('drops a decoder-cache answer that arrives after unmount', async () => {
    reachable.mockReturnValue(false)
    const hit = pending()
    const match = vi.fn(() => hit.promise)
    globalThis.caches = { open: vi.fn().mockResolvedValue({ match }) }
    const { result, unmount } = renderHook(() => useScannerAvailable())
    await waitFor(() => expect(match).toHaveBeenCalled())

    unmount()
    await act(async () => hit.settle(new Response('')))
    expect(result.current).toBe(false)
  })

  it('drops a decoder-cache failure that arrives after unmount', async () => {
    reachable.mockReturnValue(false)
    let fail
    const match = vi.fn(
      () =>
        new Promise((_, reject) => {
          fail = reject
        }),
    )
    globalThis.caches = { open: vi.fn().mockResolvedValue({ match }) }
    const { result, unmount } = renderHook(() => useScannerAvailable())
    await waitFor(() => expect(match).toHaveBeenCalled())

    unmount()
    await act(async () => fail(new Error('nope')))
    expect(result.current).toBe(false)
  })
})
