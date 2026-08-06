import { useEffect, useState } from 'react'
import { useServerReachable } from './useServerReachable'
import { WASM_CACHE_NAME, ZXING_WASM_URL } from '../utils/wasmAsset'

/**
 * Whether offering the barcode scanner makes sense at all.
 *
 * Three conditions, all required:
 *
 *   1. a secure context — `getUserMedia` does not exist over plain HTTP, which
 *      is a supported self-host setup (a NAS on the LAN);
 *   2. a camera API in this browser;
 *   3. the decoder is reachable: either the app is online, or its WebAssembly
 *      binary is already in the runtime cache from an earlier scan.
 *
 * The decoder is deliberately not precached (it would add about a megabyte to
 * every install, for a feature many users never touch), so offline-and-never-
 * scanned is a real state. Hiding the button there is the point: a scanner that
 * opens and then fails to load is worse than one that was never offered.
 */
export function useScannerAvailable() {
  const reachable = useServerReachable()
  const [decoderCached, setDecoderCached] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (typeof caches === 'undefined') return undefined
    caches
      .open(WASM_CACHE_NAME)
      .then((cache) => cache.match(ZXING_WASM_URL))
      .then((hit) => {
        if (!cancelled) setDecoderCached(Boolean(hit))
      })
      .catch(() => {
        if (!cancelled) setDecoderCached(false)
      })
    return () => {
      cancelled = true
    }
  }, [reachable])

  const secure = typeof window !== 'undefined' && window.isSecureContext
  const hasCamera = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
  return Boolean(secure && hasCamera && (reachable || decoderCached))
}
