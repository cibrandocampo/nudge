import { useEffect, useState } from 'react'
import { useServerReachable } from './useServerReachable'
import { WASM_CACHE_NAME, ZXING_WASM_URL } from '../utils/wasmAsset'

/**
 * Whether offering the barcode scanner makes sense at all.
 *
 * Four conditions, all required:
 *
 *   1. a secure context — `getUserMedia` does not exist over plain HTTP, which
 *      is a supported self-host setup (a NAS on the LAN);
 *   2. a camera API in this browser;
 *   3. the decoder is reachable: either the app is online, or its WebAssembly
 *      binary is already in the runtime cache from an earlier scan;
 *   4. the browser lists at least one camera (`videoinput`).
 *
 * The decoder is deliberately not precached (it would add about a megabyte to
 * every install, for a feature many users never touch), so offline-and-never-
 * scanned is a real state. Hiding the button there is the point: a scanner that
 * opens and then fails to load is worse than one that was never offered.
 *
 * The fourth condition closes a desktop false positive: a laptop or tower
 * without a webcam still exposes `getUserMedia`, so the scanner was offered
 * and then failed with "no camera found". Device *kinds* are listed without
 * camera permission (only labels are withheld), so the check never prompts.
 * It can only ever hide the scanner on a clear "no camera" answer: until it
 * settles, and whenever `enumerateDevices` is missing or fails, a camera is
 * assumed — hiding the scanner on a phone that has one is the worse mistake.
 */
export function useScannerAvailable() {
  const reachable = useServerReachable()
  const [decoderCached, setDecoderCached] = useState(false)
  const [cameraListed, setCameraListed] = useState(true)

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

  useEffect(() => {
    let cancelled = false
    if (typeof navigator.mediaDevices?.enumerateDevices !== 'function') return undefined
    // `then` on a fresh promise so a synchronous throw lands in `catch` too.
    Promise.resolve()
      .then(() => navigator.mediaDevices.enumerateDevices())
      .then((devices) => {
        if (!cancelled) setCameraListed(devices.some((device) => device.kind === 'videoinput'))
      })
      // No answer is not "no camera": the initial assumption stands.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const secure = typeof window !== 'undefined' && window.isSecureContext
  const hasCamera = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
  return Boolean(secure && hasCamera && cameraListed && (reachable || decoderCached))
}
