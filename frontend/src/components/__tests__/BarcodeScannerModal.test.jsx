import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import { ZXING_WASM_URL } from '../../utils/wasmAsset'
import BarcodeScannerModal from '../BarcodeScannerModal'

// jsdom has neither a camera nor a WebAssembly decoder, so both are doubled.
// What is under test is the plumbing around them: guarded failure states,
// firing exactly once, and releasing the camera.
const { readBarcodes, prepareZXingModule } = vi.hoisted(() => ({
  readBarcodes: vi.fn(),
  prepareZXingModule: vi.fn(),
}))
vi.mock('zxing-wasm/reader', () => ({ readBarcodes, prepareZXingModule }))

let tracks = []

function makeTrack({ torch = false, focusModes = null, activeDeviceId = null } = {}) {
  const caps = {}
  if (torch) caps.torch = true
  if (focusModes) caps.focusMode = focusModes
  return {
    stop: vi.fn(),
    getCapabilities: () => caps,
    getSettings: () => (activeDeviceId ? { deviceId: activeDeviceId } : {}),
    applyConstraints: vi.fn().mockResolvedValue(undefined),
  }
}

function mockCamera({ torch = false, focusModes = null, activeDeviceId = null } = {}) {
  tracks = [makeTrack({ torch, focusModes, activeDeviceId })]
  const stream = { getTracks: () => tracks, getVideoTracks: () => tracks }
  navigator.mediaDevices = { getUserMedia: vi.fn().mockResolvedValue(stream) }
  return stream
}

/**
 * Declare the lenses `enumerateDevices` reports. Every entry is a videoinput;
 * front/rear is read off the label, exactly as the component does.
 */
function mockDevices(devices, { unlabelledFirstCall = false } = {}) {
  const labelled = devices.map((d) => ({ kind: 'videoinput', ...d }))
  const fn = vi.fn().mockResolvedValue(labelled)
  // Before the origin has camera permission the browser blanks every label,
  // so the lens cannot be chosen up front — only after the first grant.
  if (unlabelledFirstCall) fn.mockResolvedValueOnce(labelled.map((d) => ({ ...d, label: '' })))
  navigator.mediaDevices.enumerateDevices = fn
}

/** Drive `document.hidden` the way backgrounding a tab does. */
function hidePage(hidden) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
  act(() => document.dispatchEvent(new Event('visibilitychange')))
}

function mockCameraFailure(name) {
  const err = new Error(name)
  err.name = name
  navigator.mediaDevices = { getUserMedia: vi.fn().mockRejectedValue(err) }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.isSecureContext = true
  readBarcodes.mockResolvedValue([])

  // A video element in jsdom reports 0×0 and cannot play; give it a frame so
  // the decode loop runs, and a 2D context so it can sample one.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })
  // jsdom throws "not implemented" for pause(); the teardown path calls it.
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, value: 640 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, value: 480 })
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
  }))
})

afterEach(() => {
  delete navigator.mediaDevices
  // `hidePage` redefines this on the document itself; leaving it set would
  // start every later test with the camera released.
  delete document.hidden
})

describe('BarcodeScannerModal', () => {
  it('hands back the decoded text once and closes', async () => {
    mockCamera()
    readBarcodes.mockResolvedValue([{ text: '0109506000134376' }])
    const onDecoded = vi.fn()
    const onClose = vi.fn()

    renderWithProviders(<BarcodeScannerModal onDecoded={onDecoded} onClose={onClose} />)

    await waitFor(() => expect(onDecoded).toHaveBeenCalledWith('0109506000134376'))
    expect(onDecoded).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('points the decoder at the locally bundled binary, never the CDN', async () => {
    // zxing-wasm defaults `locateFile` to jsDelivr, and that default string is
    // still present in the built chunk. What keeps it from ever being used is
    // this override — applied before the first read, or the very first scan
    // would reach for the network.
    mockCamera()
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(readBarcodes).toHaveBeenCalled())
    expect(prepareZXingModule).toHaveBeenCalled()
    const { overrides } = prepareZXingModule.mock.calls[0][0]
    expect(overrides.locateFile()).toBe(ZXING_WASM_URL)
    expect(ZXING_WASM_URL).not.toMatch(/jsdelivr|unpkg/)
    expect(prepareZXingModule.mock.invocationCallOrder[0]).toBeLessThan(readBarcodes.mock.invocationCallOrder[0])
  })

  it('keeps scanning when the caller rejects the read', async () => {
    mockCamera()
    readBarcodes.mockResolvedValue([{ text: 'not-a-gs1-payload' }])
    const onDecoded = vi.fn().mockReturnValue(false)
    const onClose = vi.fn()

    renderWithProviders(<BarcodeScannerModal onDecoded={onDecoded} onClose={onClose} notice="Code not recognised" />)

    await waitFor(() => expect(onDecoded).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('scan-notice')).toHaveTextContent('Code not recognised')
    // Still scanning: the read was not latched.
    await waitFor(() => expect(onDecoded.mock.calls.length).toBeGreaterThan(1))
  })

  it('keeps scanning while frames decode to nothing', async () => {
    mockCamera()
    const onDecoded = vi.fn()
    renderWithProviders(<BarcodeScannerModal onDecoded={onDecoded} onClose={vi.fn()} />)

    await waitFor(() => expect(readBarcodes).toHaveBeenCalled())
    expect(onDecoded).not.toHaveBeenCalled()
    expect(screen.getByTestId('scan-video')).toBeInTheDocument()
  })

  it('reports a denied permission as such, not as a generic failure', async () => {
    mockCameraFailure('NotAllowedError')
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByText('Camera access denied')).toBeInTheDocument()
    expect(screen.queryByTestId('scan-video')).not.toBeInTheDocument()
  })

  it('retries a camera the OS has not finished releasing', async () => {
    // Switching lenses on Android throws NotReadableError on the first attempt:
    // `track.stop()` returns before the capture session is actually torn down.
    const stream = mockCamera()
    const busy = new Error('busy')
    busy.name = 'NotReadableError'
    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValueOnce(busy).mockResolvedValue(stream)
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(readBarcodes).toHaveBeenCalled())
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('scan-error')).not.toBeInTheDocument()
  })

  it('says the camera is busy, not missing, when it stays unreadable', async () => {
    mockCameraFailure('NotReadableError')
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByText(/camera is busy/i)).toBeInTheDocument()
  })

  it('reports a missing camera', async () => {
    mockCameraFailure('NotFoundError')
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByText('No camera found')).toBeInTheDocument()
  })

  it('explains that an insecure context has no camera API at all', async () => {
    window.isSecureContext = false
    mockCamera()
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByText(/secure \(HTTPS\) connection/)).toBeInTheDocument()
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
  })

  it('reports a browser with no camera API', async () => {
    delete navigator.mediaDevices
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByText('No camera found')).toBeInTheDocument()
  })

  it('stops every camera track on unmount', async () => {
    mockCamera()
    const { unmount } = renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())
    await waitFor(() => expect(readBarcodes).toHaveBeenCalled())
    unmount()

    await waitFor(() => tracks.forEach((track) => expect(track.stop).toHaveBeenCalled()))
  })

  it('hands the camera back while the page is in the background', async () => {
    // The camera is a single-holder resource: a scanner left open in a
    // backgrounded tab locks the lens for every other tab and app.
    mockCamera()
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(readBarcodes).toHaveBeenCalled())
    const [opened] = tracks

    hidePage(true)

    await waitFor(() => expect(opened.stop).toHaveBeenCalled())
  })

  it('reopens the camera when the page comes back', async () => {
    mockCamera()
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1))

    hidePage(true)
    await waitFor(() => expect(tracks[0].stop).toHaveBeenCalled())
    hidePage(false)

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2))
  })

  it('hides the torch button when the camera does not support it', async () => {
    mockCamera({ torch: false })
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())
    expect(screen.queryByTestId('scan-torch')).not.toBeInTheDocument()
  })

  it('toggles the torch when the camera supports it', async () => {
    mockCamera({ torch: true })
    const { user } = renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    const torch = await screen.findByTestId('scan-torch')
    expect(torch).toHaveAttribute('aria-pressed', 'false')
    await user.click(torch)

    expect(tracks[0].applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] })
    await waitFor(() => expect(screen.getByTestId('scan-torch')).toHaveAttribute('aria-pressed', 'true'))
  })

  it('asks for a high-resolution stream so a small symbol survives the crop', async () => {
    mockCamera()
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())
    const { video } = navigator.mediaDevices.getUserMedia.mock.calls[0][0]
    expect(video.width).toEqual({ ideal: 1920 })
    // 4:3, so the square centre crop keeps 1440px instead of 1080.
    expect(video.height).toEqual({ ideal: 1440 })
  })

  it('switches the camera to continuous autofocus when it supports it', async () => {
    mockCamera({ focusModes: ['manual', 'continuous'] })
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(tracks[0].applyConstraints).toHaveBeenCalledWith({ focusMode: { exact: 'continuous' } }))
  })

  it('leaves a fixed-focus camera alone instead of sending it an unknown constraint', async () => {
    mockCamera({ focusModes: ['manual'] })
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())
    expect(tracks[0].applyConstraints).not.toHaveBeenCalled()
  })

  it('retries a rejected constraint in its best-effort form before giving up', async () => {
    mockCamera({ focusModes: ['continuous'] })
    // A driver that refuses `exact` may still honour the lenient request.
    tracks[0].applyConstraints.mockRejectedValueOnce(new Error('OverconstrainedError'))
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() =>
      expect(tracks[0].applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: 'continuous' }] }),
    )
  })

  it('opens the main rear lens straight away once the labels are known', async () => {
    // `facingMode: environment` picked camera 2 on a Galaxy S23+ — an ultra-wide
    // that will not focus close up — while camera 0 focuses instantly. Android
    // numbers the primary back sensor 0, so the lowest index wins.
    mockCamera({ activeDeviceId: 'id-0' })
    mockDevices([
      { deviceId: 'id-1', label: 'camera 1, facing front' },
      { deviceId: 'id-2', label: 'camera 2, facing back' },
      { deviceId: 'id-0', label: 'camera 0, facing back' },
    ])
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())
    expect(navigator.mediaDevices.getUserMedia.mock.calls[0][0].video.deviceId).toEqual({ exact: 'id-0' })
    // No reopen: the right lens was requested the first time.
    await waitFor(() => expect(readBarcodes).toHaveBeenCalled())
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('corrects to the main rear lens after the first permission grant', async () => {
    mockCamera({ activeDeviceId: 'id-2' })
    mockDevices(
      [
        { deviceId: 'id-2', label: 'camera 2, facing back' },
        { deviceId: 'id-0', label: 'camera 0, facing back' },
      ],
      { unlabelledFirstCall: true },
    )
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    // Blank labels first: nothing to pick, so the generic hint opens the camera
    // and grants permission. Labels then exist, and the lens is corrected.
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2))
    expect(navigator.mediaDevices.getUserMedia.mock.calls[0][0].video.facingMode).toBe('environment')
    expect(navigator.mediaDevices.getUserMedia.mock.calls[1][0].video.deviceId).toEqual({ exact: 'id-0' })
  })

  it('hides the lens picker when there is only one rear camera', async () => {
    mockCamera({ activeDeviceId: 'id-0' })
    mockDevices([
      { deviceId: 'id-0', label: 'camera 0, facing back' },
      { deviceId: 'id-1', label: 'camera 1, facing front' },
    ])
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(readBarcodes).toHaveBeenCalled())
    expect(screen.queryByTestId('scan-camera')).not.toBeInTheDocument()
  })

  it('reads facingMode from the device rather than trusting the label', async () => {
    // Chrome exposes `InputDeviceInfo.getCapabilities()` without opening the
    // camera. Labels are localised and vendor-specific, so when capabilities
    // disagree with the label, capabilities win.
    mockCamera({ activeDeviceId: 'id-back' })
    mockDevices([
      { deviceId: 'id-front', label: 'Cámara trasera', getCapabilities: () => ({ facingMode: ['user'] }) },
      { deviceId: 'id-back', label: 'Cámara frontal', getCapabilities: () => ({ facingMode: ['environment'] }) },
    ])
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(readBarcodes).toHaveBeenCalled())
    // Only one lens is genuinely rear-facing, so there is nothing to switch to.
    expect(screen.queryByTestId('scan-camera')).not.toBeInTheDocument()
  })

  it('falls back to the largest sensor when no label carries an index', async () => {
    mockCamera({ activeDeviceId: 'id-small' })
    mockDevices([
      {
        deviceId: 'id-small',
        label: 'Back camera',
        getCapabilities: () => ({ facingMode: ['environment'], width: { max: 4000 }, height: { max: 3000 } }),
      },
      {
        deviceId: 'id-big',
        label: 'Back camera',
        getCapabilities: () => ({ facingMode: ['environment'], width: { max: 4080 }, height: { max: 3060 } }),
      },
    ])
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())
    expect(navigator.mediaDevices.getUserMedia.mock.calls[0][0].video.deviceId).toEqual({ exact: 'id-big' })
  })

  it('remembers the lens that completed a scan and reopens on it', async () => {
    mockCamera({ activeDeviceId: 'id-2' })
    mockDevices([
      { deviceId: 'id-0', label: 'camera 0, facing back' },
      { deviceId: 'id-2', label: 'camera 2, facing back' },
    ])
    readBarcodes.mockResolvedValue([{ text: '0109506000134376' }])
    const { unmount } = renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(localStorage.getItem('scanner_camera_id')).toBe('id-2'))
    unmount()

    // Second open: proof beats the camera-0 heuristic, because that lens is
    // the one this device has actually scanned with.
    mockCamera({ activeDeviceId: 'id-2' })
    mockDevices([
      { deviceId: 'id-0', label: 'camera 0, facing back' },
      { deviceId: 'id-2', label: 'camera 2, facing back' },
    ])
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())
    expect(navigator.mediaDevices.getUserMedia.mock.calls[0][0].video.deviceId).toEqual({ exact: 'id-2' })
  })

  it('does not remember a lens when the caller rejects the read', async () => {
    mockCamera({ activeDeviceId: 'id-2' })
    mockDevices([
      { deviceId: 'id-0', label: 'camera 0, facing back' },
      { deviceId: 'id-2', label: 'camera 2, facing back' },
    ])
    readBarcodes.mockResolvedValue([{ text: 'not-a-gs1-payload' }])
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn().mockReturnValue(false)} onClose={vi.fn()} />)

    await waitFor(() => expect(readBarcodes).toHaveBeenCalled())
    expect(localStorage.getItem('scanner_camera_id')).toBeNull()
  })

  it('falls back to the heuristic when the remembered lens is gone', async () => {
    // Revoking the permission or clearing site data mints new deviceIds.
    // Requesting a stale one throws OverconstrainedError — a dead camera.
    localStorage.setItem('scanner_camera_id', 'id-from-a-previous-grant')
    mockCamera({ activeDeviceId: 'id-0' })
    mockDevices([
      { deviceId: 'id-0', label: 'camera 0, facing back' },
      { deviceId: 'id-2', label: 'camera 2, facing back' },
    ])
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())
    expect(navigator.mediaDevices.getUserMedia.mock.calls[0][0].video.deviceId).toEqual({ exact: 'id-0' })
  })

  it('cycles to the next rear lens on request rather than reopening the current one', async () => {
    mockCamera({ activeDeviceId: 'id-0' })
    mockDevices([
      { deviceId: 'id-0', label: 'camera 0, facing back' },
      { deviceId: 'id-2', label: 'camera 2, facing back' },
    ])
    const { user } = renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await user.click(await screen.findByTestId('scan-camera'))

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2))
    expect(navigator.mediaDevices.getUserMedia.mock.calls[1][0].video.deviceId).toEqual({ exact: 'id-2' })
  })
})
