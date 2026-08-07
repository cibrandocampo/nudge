import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ModalFrame from './ModalFrame'
import Icon from './Icon'
import cx from '../utils/cx'
import { ZXING_WASM_URL } from '../utils/wasmAsset'
import { readScannerCamera, rememberScannerCamera } from '../utils/scannerCamera'
import shared from '../styles/shared.module.css'
import s from './BarcodeScannerModal.module.css'

// Fraction of the shorter video side used as the decode region. A pharmacy
// DataMatrix is small and the user centres it, so cropping cuts the work per
// frame without losing the symbol.
const CROP_RATIO = 0.7
// Decoding every animation frame saturates the main thread on a phone; a scan
// still feels instant at this cadence.
const DECODE_INTERVAL_MS = 150

// A pharmacy DataMatrix is a few millimetres wide, and the browser's default
// capture is often 640x480 — at that size the symbol lands on too few pixels to
// decode. Asking for 1080p is a hint (`ideal`), so a camera that cannot deliver
// it still starts instead of failing with OverconstrainedError.
// 4:3 on purpose: the decoder gets a *square* centre crop, so what matters is
// the shorter side. A 1920x1080 stream yields a 1080px square, the same width
// of sensor read out as 1920x1440 yields a 1440px one — a third more pixels on
// the symbol for free. It also matches the native 4:3 output of the sensor
// (the phone's own camera app writes 4000x3000), so no video mode has to crop.
const IDEAL_WIDTH = 1920
const IDEAL_HEIGHT = 1440

// How long to wait before retrying a camera the OS has not released yet, and
// how many times. Switching lenses on a Galaxy S23+ fails on the first attempt
// and succeeds on the second, so one retry would do; two is cheap insurance.
const REOPEN_RETRY_MS = 350
const REOPEN_RETRIES = 2

function stopStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop())
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Open a camera, retrying while the previous one is still being released.
 *
 * `track.stop()` returns immediately but Android tears the capture session
 * down asynchronously, so requesting the next lens right after a switch throws
 * `NotReadableError` — the camera exists and the constraints are valid, the
 * hardware is simply still busy. Retrying after a short pause fixes it; every
 * other failure is real and propagates untouched.
 */
async function openCamera(constraints, isCancelled) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (err) {
      if (err?.name !== 'NotReadableError' || attempt >= REOPEN_RETRIES) throw err
      await wait(REOPEN_RETRY_MS)
      if (isCancelled()) throw err
    }
  }
}

// Serialises camera acquisition across effect runs. Android refuses to open a
// lens another capture session still holds, and an effect can be torn down
// while its `getUserMedia` is still resolving — StrictMode's double mount does
// it on every open, and switching lenses does it for real. Without a queue the
// late stream and the new request overlap, and the new one loses with
// NotReadableError, or arrives as a black frame.
let cameraQueue = Promise.resolve()

/**
 * Open a camera once every earlier acquisition has settled.
 *
 * Returns `null` when the caller was torn down while waiting; the stream it
 * would have received is stopped here, so an abandoned request can never keep
 * holding the lens.
 */
function acquireCamera(constraints, isCancelled) {
  const attempt = cameraQueue
    .catch(() => {})
    .then(async () => {
      if (isCancelled()) return null
      const stream = await openCamera(constraints, isCancelled)
      if (isCancelled()) {
        stopStream(stream)
        return null
      }
      return stream
    })
  // The queue must survive a failed attempt, or one error would wedge it.
  cameraQueue = attempt.catch(() => {})
  return attempt
}

/**
 * Apply a camera constraint and report whether it actually took effect.
 *
 * Constraints inside `advanced` are best-effort by spec: a camera that cannot
 * honour one ignores it *silently*, which is indistinguishable from a control
 * that does nothing. So ask with `exact` first — that rejects loudly when the
 * value is not supported — and only fall back to the lenient form. The final
 * word is `getSettings()`: the driver may accept the call and still not move.
 */
async function applyTrackConstraint(track, constraint) {
  const exact = Object.fromEntries(Object.entries(constraint).map(([k, v]) => [k, { exact: v }]))
  try {
    await track.applyConstraints(exact)
    return true
  } catch {
    try {
      await track.applyConstraints({ advanced: [constraint] })
      return true
    } catch {
      return false
    }
  }
}

/**
 * Ask the track for continuous autofocus, ignoring cameras that don't do it.
 *
 * `focusMode` is not in the standard MediaTrackConstraints set, so it goes in
 * `advanced` (best-effort by spec) and is applied only when the capability is
 * actually advertised — some drivers throw on an unknown constraint name.
 */
/**
 * Whether a device is a rear-facing camera.
 *
 * Chrome hands back `InputDeviceInfo`, whose `getCapabilities()` reports
 * `facingMode` without opening the camera — a far better signal than the
 * label, which is localised, vendor-specific, and blank until permission is
 * granted. Firefox and Safari have no `getCapabilities` on the device, so the
 * label stays as the fallback.
 */
function isRearCamera(device) {
  if (typeof device.getCapabilities === 'function') {
    try {
      const facing = device.getCapabilities().facingMode
      if (Array.isArray(facing) && facing.length > 0) return facing.includes('environment')
    } catch {
      // Fall through to the label.
    }
  }
  return !/front|user/i.test(device.label)
}

/**
 * Pick the rear lens most likely to be the main camera.
 *
 * `facingMode: 'environment'` lets the browser choose, and on a Galaxy S23+ it
 * chooses "camera 2" — an ultra-wide that will not focus on a label held close,
 * while "camera 0" focuses it instantly. Android numbers its cameras with the
 * primary back sensor at index 0, so the lowest index in a label like
 * "camera2 0, facing back" is the best signal available.
 *
 * Per-device capabilities cannot settle it: on that phone the two rear lenses
 * report 4080x3060 and 4000x3000, and neither exposes `focusMode` or `zoom`
 * until its track is open. Largest sensor only breaks a tie when no label
 * carries an index — it did pick the right lens there, but by 2%, so it is a
 * last resort rather than the rule.
 */
function preferredRearCamera(rear) {
  const indexed = rear
    .map((device) => ({ device, index: Number(device.label.match(/(\d+)\s*,\s*facing back/i)?.[1] ?? NaN) }))
    .filter(({ index }) => Number.isFinite(index))
  if (indexed.length > 0) {
    return indexed.reduce((lowest, cur) => (cur.index < lowest.index ? cur : lowest)).device
  }

  const sized = rear
    .map((device) => {
      let pixels = 0
      try {
        const caps = device.getCapabilities?.() ?? {}
        pixels = (caps.width?.max ?? 0) * (caps.height?.max ?? 0)
      } catch {
        pixels = 0
      }
      return { device, pixels }
    })
    .filter(({ pixels }) => pixels > 0)
  if (sized.length === 0) return null
  return sized.reduce((biggest, cur) => (cur.pixels > biggest.pixels ? cur : biggest)).device
}

async function enableContinuousFocus(track) {
  const modes = track?.getCapabilities?.().focusMode
  if (!Array.isArray(modes) || !modes.includes('continuous')) return
  await applyTrackConstraint(track, { focusMode: 'continuous' })
}

/**
 * Camera modal that decodes a 2D barcode and hands back the **raw** string.
 *
 * It does not interpret the payload — `utils/gs1.js` does that — so the only
 * contract here is: give the caller exactly what the symbol contained, GS
 * separators and all.
 *
 * The decoder is `zxing-wasm` (ZXing-C++ compiled to WebAssembly), imported
 * dynamically so neither the JS glue nor the ~1 MB binary is fetched until the
 * modal actually opens. `BarcodeDetector` is not used as the primary path:
 * WebKit does not implement it, so every iPhone would fall back anyway.
 *
 * Props:
 *   onDecoded(rawText) — called with a successful read. Return `false` to
 *                        reject it and keep scanning (e.g. the payload is not
 *                        a code this app understands); anything else accepts,
 *                        and the modal closes without firing again.
 *   onClose            — dismissal (also called right after an accepted read)
 *   notice             — message shown under the viewport, e.g. why the last
 *                        read was rejected
 */
export default function BarcodeScannerModal({ onDecoded, onClose, notice = null }) {
  const { t } = useTranslation()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const decodedRef = useRef(false)
  const timerRef = useRef(null)
  const [error, setError] = useState(null)
  const [torchOn, setTorchOn] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)
  // A phone exposes several rear lenses and `facingMode: 'environment'` lets
  // the browser pick. That pick is not always the one that focuses close up —
  // an ultra-wide is often fixed-focus — and the page cannot tell which is
  // which, since the labels are just "camera 0, facing back". So offer the
  // choice instead of guessing, and say why it might be needed.
  const [cameras, setCameras] = useState([])
  const [deviceId, setDeviceId] = useState(null)
  // Which lens the browser actually opened. Kept apart from `deviceId` (the
  // *requested* one) and deliberately out of the effect's deps: the first run
  // requests nothing, so cycling has to start from what it got, not from null.
  const [activeDeviceId, setActiveDeviceId] = useState(null)
  // The last lens that actually opened, and whether we have already fallen back
  // to it. Switching is normally reliable, but the camera is a single-holder
  // resource: another tab or app owning it makes the request fail with
  // NotReadableError. A scanner that dies on a curiosity tap is far worse than
  // one that quietly stays on the lens that was working.
  const lastGoodDeviceRef = useRef(null)
  const fellBackRef = useRef(false)
  const [switchRefused, setSwitchRefused] = useState(false)
  // Hand the camera back while the page is in the background. It is a
  // single-holder resource: a scanner left open in a forgotten tab keeps the
  // lens locked, and every later request — in this app or any other — fails
  // with NotReadableError.
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || !document.hidden)

  useEffect(() => {
    const sync = () => setPageVisible(!document.hidden)
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  useEffect(() => {
    let cancelled = false
    const videoEl = videoRef.current

    // Backgrounded: the previous run's cleanup has already released the lens,
    // and there is nothing to decode for a viewport nobody can see. Returning
    // to the tab re-runs this effect and reopens the same camera.
    if (!pageVisible) return undefined

    // `getUserMedia` simply does not exist outside a secure context, so this
    // is not a permission problem and must not be reported as one.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setError('insecure')
      return undefined
    }
    if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      setError('noCamera')
      return undefined
    }

    const start = async () => {
      // Once the origin holds camera permission — every open after the first —
      // `enumerateDevices` already returns labels, so the main lens can be
      // requested straight away instead of opening whatever the browser
      // prefers and then reopening. On the very first run labels are blank,
      // `preferredRearCamera` finds nothing, and the correction below applies.
      let wanted = deviceId
      if (!wanted) {
        const known = await navigator.mediaDevices
          .enumerateDevices?.()
          .then((list) => list.filter((d) => d.kind === 'videoinput' && isRearCamera(d)))
          .catch(() => [])
        const rearCameras = known ?? []
        // A lens that has already completed a scan on this device beats any
        // guess — but only while it still exists. Revoking the permission or
        // clearing site data mints new ids, and a stale one would make
        // `getUserMedia` throw OverconstrainedError and look like a dead camera.
        const remembered = readScannerCamera()
        const stillPresent = remembered && rearCameras.some((d) => d.deviceId === remembered)
        wanted = (stillPresent ? remembered : null) ?? preferredRearCamera(rearCameras)?.deviceId ?? null
      }
      if (cancelled) return

      let stream
      try {
        stream = await acquireCamera(
          {
            video: {
              // An explicit pick must win over the generic rear-facing hint.
              ...(wanted ? { deviceId: { exact: wanted } } : { facingMode: 'environment' }),
              width: { ideal: IDEAL_WIDTH },
              height: { ideal: IDEAL_HEIGHT },
              advanced: [{ focusMode: 'continuous' }],
            },
          },
          () => cancelled,
        )
      } catch (err) {
        if (cancelled) return
        // A refused *switch* is recoverable: go back to the lens that was
        // working and say so, instead of leaving a dead modal behind. Only
        // once, so a lens that also fails cannot ping-pong.
        const lastGood = lastGoodDeviceRef.current
        if (wanted && lastGood && lastGood !== wanted && !fellBackRef.current) {
          fellBackRef.current = true
          setSwitchRefused(true)
          setDeviceId(lastGood)
          return
        }
        if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') setError('permission')
        // The lens is there but the OS would not hand it over — another app
        // holding the camera, most often. Saying "no camera found" sends the
        // user looking for the wrong problem.
        else if (err?.name === 'NotReadableError') setError('busy')
        else setError('noCamera')
        return
      }
      // `acquireCamera` returns null when this run was torn down while queued;
      // it has already released whatever it opened.
      if (!stream || cancelled) {
        stopStream(stream)
        return
      }
      streamRef.current = stream

      const track = stream.getVideoTracks?.()[0]
      const caps = track?.getCapabilities?.() ?? {}
      setTorchAvailable(Boolean(caps.torch))

      // `getUserMedia` already asked for continuous focus, but a camera that
      // ignored the hint there may still accept it once the track is live.
      await enableContinuousFocus(track)

      const settings = track?.getSettings?.() ?? {}
      // Labels are only populated once permission has been granted, which by
      // now it has — so this lists every rear lens the browser can offer. A
      // front camera is never what you scan a box with.
      const videoInputs = await navigator.mediaDevices
        .enumerateDevices?.()
        .then((list) => list.filter((d) => d.kind === 'videoinput'))
        .catch(() => [])
      const rear = (videoInputs ?? []).filter(isRearCamera)
      if (cancelled) return
      setCameras(rear.length > 1 ? rear : [])
      setActiveDeviceId(settings.deviceId ?? null)
      lastGoodDeviceRef.current = settings.deviceId ?? wanted ?? null
      // This open succeeded, so a later switch gets its own chance to fall back.
      fellBackRef.current = false

      // First open on a fresh permission grant: labels were blank a moment ago,
      // so the lens could not be chosen up front. Now that they exist, correct
      // the pick. Setting `deviceId` re-runs this effect, and `wanted` being
      // set on that run keeps the correction to exactly one.
      const preferred = preferredRearCamera(rear)
      if (!wanted && preferred && preferred.deviceId !== settings.deviceId) {
        setDeviceId(preferred.deviceId)
        return
      }

      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        // jsdom (and a browser that refuses autoplay) rejects here; the decode
        // loop copes with an empty frame, so this must never throw.
        await video.play?.().catch(() => {})
      }

      let readBarcodes
      try {
        const reader = await import('zxing-wasm/reader')
        reader.prepareZXingModule({ overrides: { locateFile: () => ZXING_WASM_URL } })
        readBarcodes = reader.readBarcodes
      } catch {
        if (!cancelled) setError('decoder')
        return
      }
      if (cancelled) return

      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext?.('2d') ?? null

      const scan = async () => {
        if (cancelled || decodedRef.current) return
        const el = videoRef.current
        const width = el?.videoWidth ?? 0
        const height = el?.videoHeight ?? 0
        if (ctx && width > 0 && height > 0) {
          const size = Math.floor(Math.min(width, height) * CROP_RATIO)
          canvas.width = size
          canvas.height = size
          ctx.drawImage(el, (width - size) / 2, (height - size) / 2, size, size, 0, 0, size, size)
          try {
            const results = await readBarcodes(ctx.getImageData(0, 0, size, size), {
              formats: ['DataMatrix', 'QRCode'],
              // Plain keeps the payload byte-for-byte, GS separators included.
              // (The GS1 parser also understands the bracketed HRI form, so a
              // decoder default of "HRI" would still be readable.)
              textMode: 'Plain',
              tryHarder: true,
              maxNumberOfSymbols: 1,
            })
            const text = results?.[0]?.text
            if (text && !decodedRef.current) {
              // The caller may reject a read it cannot use (an unrecognised
              // payload) by returning false: the user is still holding the box
              // up to the camera, so closing would be the wrong answer.
              if (onDecoded(text) !== false) {
                decodedRef.current = true
                // Read the id off the live track rather than trusting state:
                // this is the lens that actually produced the scan.
                rememberScannerCamera(track?.getSettings?.().deviceId)
                onClose()
                return
              }
            }
          } catch {
            // A frame that fails to decode is the normal case, not an error.
          }
        }
        if (!cancelled && !decodedRef.current) {
          timerRef.current = setTimeout(scan, DECODE_INTERVAL_MS)
        }
      }
      scan()
    }

    start()

    return () => {
      cancelled = true
      clearTimeout(timerRef.current)
      // Detach before stopping, so nothing keeps referencing a live stream
      // while its tracks are being released. Captured at effect setup because
      // the ref may already point elsewhere by the time cleanup runs.
      if (videoEl) {
        videoEl.pause?.()
        videoEl.srcObject = null
      }
      stopStream(streamRef.current)
      streamRef.current = null
    }
    // `deviceId` is a dependency on purpose: picking another lens has to tear
    // the stream down and open the new one, which is exactly what a re-run
    // does. `pageVisible` rides the same mechanism to release and reacquire.
  }, [onDecoded, onClose, deviceId, pageVisible])

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks?.()[0]
    if (!track) return
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] })
      setTorchOn(next)
    } catch {
      setTorchAvailable(false)
    }
  }

  const switchCamera = () => {
    const at = cameras.findIndex((d) => d.deviceId === (deviceId ?? activeDeviceId))
    // `at === -1` would wrap to index 0, which on the first press is the lens
    // already open — reopening it looks like a dead button.
    setDeviceId(cameras[(at + 1) % cameras.length].deviceId)
  }

  const errorMessage = error
    ? {
        insecure: t('scan.errorInsecure'),
        permission: t('scan.errorPermission'),
        noCamera: t('scan.errorNoCamera'),
        busy: t('scan.errorBusy'),
        decoder: t('scan.errorDecoder'),
      }[error]
    : null

  return (
    <ModalFrame onClose={onClose} title={t('scan.title')} size="lg">
      {errorMessage ? (
        <p className={shared.error} data-testid="scan-error">
          {errorMessage}
        </p>
      ) : (
        <>
          <div className={s.viewport}>
            <video ref={videoRef} className={s.video} autoPlay muted playsInline data-testid="scan-video" />
            <div className={s.reticle} aria-hidden="true" />
          </div>
          {notice ? (
            <p className={cx(shared.error, s.notice)} data-testid="scan-notice">
              {notice}
            </p>
          ) : (
            <p className={s.hint}>{t('scan.hint')}</p>
          )}
          {cameras.length > 1 && (
            <p className={cx(s.cameraHint, switchRefused && shared.error)} data-testid="scan-camera-hint">
              {switchRefused ? t('scan.cameraRefused') : t('scan.cameraHint')}
            </p>
          )}
          {(torchAvailable || cameras.length > 1) && (
            <div className={s.controls}>
              {torchAvailable && (
                <button
                  type="button"
                  className={cx(shared.btn, shared.btnSecondary, s.controlBtn)}
                  onClick={toggleTorch}
                  aria-pressed={torchOn}
                  data-testid="scan-torch"
                >
                  <Icon name="zap" size="sm" />
                  {t('scan.torch')}
                </button>
              )}
              {cameras.length > 1 && (
                <button
                  type="button"
                  className={cx(shared.btn, shared.btnSecondary, s.controlBtn, s.cameraBtn)}
                  onClick={switchCamera}
                  aria-label={t('scan.camera')}
                  title={t('scan.camera')}
                  data-testid="scan-camera"
                >
                  {/* The same emoji on both sides on purpose: 📸 reads as "camera
                      with flash", which would collide with the torch button. */}
                  <span aria-hidden="true">📷</span>
                  <span aria-hidden="true" className={s.cameraArrow}>
                    →
                  </span>
                  <span aria-hidden="true">📷</span>
                </button>
              )}
            </div>
          )}
        </>
      )}
    </ModalFrame>
  )
}
