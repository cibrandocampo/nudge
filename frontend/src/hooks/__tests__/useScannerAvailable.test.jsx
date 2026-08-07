import { renderHook, waitFor } from '@testing-library/react'
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
