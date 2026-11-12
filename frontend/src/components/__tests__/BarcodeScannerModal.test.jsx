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

  it('returns to the working lens and says so when the switch is refused', async () => {
    const stream = mockCamera({ activeDeviceId: 'id-0' })
    mockDevices([
      { deviceId: 'id-0', label: 'camera 0, facing back' },
      { deviceId: 'id-2', label: 'camera 2, facing back' },
    ])
    const { user } = renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)
    await screen.findByTestId('scan-camera')
    expect(screen.getByTestId('scan-camera-hint')).toHaveTextContent('If it will not focus')

    // The second lens will not open. A dead modal would be the worst outcome:
    // the first lens still works, so go back to it and explain.
    const refused = new Error('OverconstrainedError')
    refused.name = 'OverconstrainedError'
    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValueOnce(refused).mockResolvedValue(stream)
    await user.click(screen.getByTestId('scan-camera'))

    await waitFor(() =>
      expect(screen.getByTestId('scan-camera-hint')).toHaveTextContent('would not release the other camera'),
    )
    expect(screen.queryByTestId('scan-error')).not.toBeInTheDocument()
    const lastCall = navigator.mediaDevices.getUserMedia.mock.calls.at(-1)
    expect(lastCall[0].video.deviceId).toEqual({ exact: 'id-0' })
  })

  it('copes with a track that reports neither capabilities nor settings', async () => {
    // Not every implementation ships the whole MediaStreamTrack surface, and
    // a missing method must not read as "no torch, no camera".
    tracks = [{ stop: vi.fn(), applyConstraints: vi.fn().mockResolvedValue(undefined) }]
    const stream = { getTracks: () => tracks, getVideoTracks: () => tracks }
    navigator.mediaDevices = { getUserMedia: vi.fn().mockResolvedValue(stream) }
    mockDevices([{ deviceId: 'id-0', label: 'camera 0, facing back' }])
    readBarcodes.mockResolvedValue([{ text: '0109506000134376' }])
    const onDecoded = vi.fn()

    renderWithProviders(<BarcodeScannerModal onDecoded={onDecoded} onClose={vi.fn()} />)

    await waitFor(() => expect(onDecoded).toHaveBeenCalledWith('0109506000134376'))
    expect(screen.queryByTestId('scan-torch')).not.toBeInTheDocument()
  })

  it('says the scanner could not load when the decoder module fails', async () => {
    mockCamera()
    prepareZXingModule.mockImplementationOnce(() => {
      throw new Error('wasm fetch failed')
    })

    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByText('Could not load the scanner. Check your connection.')).toBeInTheDocument()
  })

  it('says the scanner could not load when the decoder binary fails to compile', async () => {
    mockCamera()
    prepareZXingModule.mockRejectedValueOnce(new Error('CompileError: violates Content Security Policy'))
    readBarcodes.mockResolvedValue([{ text: '0109506000134376' }])

    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByText('Could not load the scanner. Check your connection.')).toBeInTheDocument()
    expect(prepareZXingModule.mock.calls[0][0].fireImmediately).toBe(true)
    expect(readBarcodes).not.toHaveBeenCalled()
  })

  it('never samples a frame when the canvas has no 2D context', async () => {
    mockCamera()
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
    readBarcodes.mockResolvedValue([{ text: '0109506000134376' }])

    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await screen.findByTestId('scan-video')
    await new Promise((r) => setTimeout(r, 50))
    expect(readBarcodes).not.toHaveBeenCalled()
  })

  it('waits for the video to report a size before decoding', async () => {
    mockCamera()
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, value: undefined })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, value: undefined })
    readBarcodes.mockResolvedValue([{ text: '0109506000134376' }])

    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await screen.findByTestId('scan-video')
    await new Promise((r) => setTimeout(r, 50))
    expect(readBarcodes).not.toHaveBeenCalled()
  })

  it('picks the largest sensor even when it is listed first', async () => {
    mockCamera({ activeDeviceId: 'big' })
    mockDevices([
      { deviceId: 'big', label: 'back lens', getCapabilities: () => ({ width: { max: 4000 }, height: { max: 3000 } }) },
      { deviceId: 'small', label: 'back lens', getCapabilities: () => ({ width: { max: 640 }, height: { max: 480 } }) },
    ])

    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())
    expect(navigator.mediaDevices.getUserMedia.mock.calls[0][0].video.deviceId).toEqual({ exact: 'big' })
  })

  it('releases a camera that arrives after the modal is gone', async () => {
    const stream = mockCamera()
    let release
    navigator.mediaDevices.getUserMedia = vi.fn(() => new Promise((r) => (release = () => r(stream))))
    mockDevices([{ deviceId: 'id-0', label: 'camera 0, facing back' }])

    const { unmount } = renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)
    await screen.findByTestId('scan-video')
    unmount()
    await act(async () => {
      release()
      await Promise.resolve()
    })

    // Nothing is left holding the lens: the stream that landed late is stopped
    // rather than leaked, which is what makes reopening the scanner work.
    await waitFor(() => expect(tracks[0].stop).toHaveBeenCalled())
  })

  it('keeps scanning when the browser refuses to autoplay the preview', async () => {
    mockCamera()
    HTMLMediaElement.prototype.play.mockRejectedValue(new DOMException('autoplay refused', 'NotAllowedError'))
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(readBarcodes).toHaveBeenCalled())
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    expect(screen.queryByTestId('scan-error')).not.toBeInTheDocument()
  })

  it('releases the camera when the decoder cannot load', async () => {
    // The error panel replaces the viewport; a lens left open behind it keeps
    // the camera light on and locks the camera for every other app.
    mockCamera()
    prepareZXingModule.mockRejectedValueOnce(new Error('CompileError'))
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await screen.findByTestId('scan-error')
    await waitFor(() => expect(tracks[0].stop).toHaveBeenCalled())
  })

  it('does not reopen the camera after an accepted read', async () => {
    mockCamera()
    readBarcodes.mockResolvedValue([{ text: '0109506000134376' }])
    const onClose = vi.fn()
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={onClose} />)
    await waitFor(() => expect(onClose).toHaveBeenCalled())

    // Backgrounding and returning before the parent unmounts the modal re-runs
    // the camera effect; the scan is over, so it must not open a lens again.
    hidePage(true)
    hidePage(false)

    await waitFor(() => expect(tracks[0].stop).toHaveBeenCalled())
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('still opens the camera when the lens list cannot be read', async () => {
    mockCamera()
    navigator.mediaDevices.enumerateDevices = vi.fn().mockRejectedValue(new Error('enumerate failed'))
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(readBarcodes).toHaveBeenCalled())
    // Both listings failed (before and after opening): the generic rear hint
    // opens the camera, and there is no picker to offer.
    expect(navigator.mediaDevices.enumerateDevices).toHaveBeenCalledTimes(2)
    expect(navigator.mediaDevices.getUserMedia.mock.calls[0][0].video.facingMode).toBe('environment')
    expect(screen.queryByTestId('scan-camera')).not.toBeInTheDocument()
  })

  it('keeps scanning when the camera refuses a constraint both ways', async () => {
    mockCamera({ focusModes: ['continuous'] })
    tracks[0].applyConstraints.mockRejectedValue(new Error('OverconstrainedError'))
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(readBarcodes).toHaveBeenCalled())
    expect(tracks[0].applyConstraints).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('scan-error')).not.toBeInTheDocument()
  })

  it('ranks a lens whose capabilities throw below one that reports a size', async () => {
    mockCamera({ activeDeviceId: 'id-sized' })
    mockDevices([
      {
        deviceId: 'id-broken',
        label: 'Back camera',
        getCapabilities: () => {
          throw new Error('not implemented')
        },
      },
      {
        deviceId: 'id-sized',
        label: 'Back camera',
        getCapabilities: () => ({ width: { max: 640 }, height: { max: 480 } }),
      },
    ])
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(readBarcodes).toHaveBeenCalled())
    expect(navigator.mediaDevices.getUserMedia.mock.calls[0][0].video.deviceId).toEqual({ exact: 'id-sized' })
  })

  it('hides the torch when the camera turns out not to honour it', async () => {
    mockCamera({ torch: true })
    tracks[0].applyConstraints.mockRejectedValueOnce(new Error('torch unsupported'))
    const { user } = renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)

    await user.click(await screen.findByTestId('scan-torch'))

    await waitFor(() => expect(screen.queryByTestId('scan-torch')).not.toBeInTheDocument())
  })

  it('ignores the torch while the next lens is still opening', async () => {
    const stream = mockCamera({ torch: true, activeDeviceId: 'id-0' })
    mockDevices([
      { deviceId: 'id-0', label: 'camera 0, facing back' },
      { deviceId: 'id-2', label: 'camera 2, facing back' },
    ])
    const { user } = renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)
    await screen.findByTestId('scan-camera')

    const opening = deferred()
    navigator.mediaDevices.getUserMedia = vi.fn(() => opening.promise)
    await user.click(screen.getByTestId('scan-camera'))
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())

    // The old lens is released and the new one has not arrived: there is no
    // track to drive, so the press must do nothing rather than throw.
    await user.click(screen.getByTestId('scan-torch'))
    expect(tracks[0].applyConstraints).not.toHaveBeenCalled()
    expect(screen.getByTestId('scan-torch')).toHaveAttribute('aria-pressed', 'false')

    opening.resolve(stream)
    await waitFor(() => expect(prepareZXingModule).toHaveBeenCalledTimes(2))
  })
})

/** A promise the test settles by hand, to hold the scanner at one `await`. */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Let the effect's pending continuations run after a manual settle. */
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)))

// Closing the modal (or backgrounding the page) while one of the scanner's
// awaits is pending: whatever that await yields must be dropped, and the lens
// must not stay open. Each test parks the effect at one await.
describe('BarcodeScannerModal torn down mid-start', () => {
  it('opens nothing when closed while the lenses are being listed', async () => {
    mockCamera()
    const listing = deferred()
    navigator.mediaDevices.enumerateDevices = vi.fn(() => listing.promise)
    const { unmount } = renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(navigator.mediaDevices.enumerateDevices).toHaveBeenCalled())

    unmount()
    listing.resolve([{ kind: 'videoinput', deviceId: 'id-0', label: 'camera 0, facing back' }])
    await flush()

    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
  })

  it('does not retry a busy camera once the modal is closed', async () => {
    mockCameraFailure('NotReadableError')
    const { unmount } = renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1))

    unmount()
    // Past the retry pause: a retry would have asked for the camera again.
    await act(() => new Promise((r) => setTimeout(r, 450)))

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('drops a camera request still queued behind an earlier one', async () => {
    // Backgrounding and returning while the first request is still pending
    // queues a second one behind it; closing then must cancel the queued one
    // before it ever reaches the hardware.
    const stream = mockCamera()
    const opening = deferred()
    navigator.mediaDevices.getUserMedia = vi.fn(() => opening.promise)
    const { unmount } = renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1))

    hidePage(true)
    hidePage(false)
    await flush()
    unmount()
    await act(async () => {
      opening.resolve(stream)
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
    expect(tracks[0].stop).toHaveBeenCalled()
  })

  it('loads no decoder when closed while the lenses are re-listed', async () => {
    mockCamera()
    const relisting = deferred()
    navigator.mediaDevices.enumerateDevices = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => relisting.promise)
    const { unmount } = renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(navigator.mediaDevices.enumerateDevices).toHaveBeenCalledTimes(2))

    unmount()
    relisting.resolve([])
    await flush()

    expect(prepareZXingModule).not.toHaveBeenCalled()
    expect(tracks[0].stop).toHaveBeenCalled()
  })

  it('reads no frame when closed while the decoder compiles', async () => {
    mockCamera()
    const compiling = deferred()
    prepareZXingModule.mockImplementationOnce(() => compiling.promise)
    const { unmount } = renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(prepareZXingModule).toHaveBeenCalled())

    unmount()
    compiling.resolve()
    await flush()

    expect(readBarcodes).not.toHaveBeenCalled()
    expect(tracks[0].stop).toHaveBeenCalled()
  })

  it('does not let a stale compile failure mask the next attempt', async () => {
    // Backgrounded mid-compile, then the compile fails: that run is over, so
    // its failure must not paint an error over the run that replaces it.
    mockCamera()
    const compiling = deferred()
    prepareZXingModule.mockImplementationOnce(() => compiling.promise)
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(prepareZXingModule).toHaveBeenCalled())

    hidePage(true)
    await act(async () => {
      compiling.reject(new Error('NetworkError'))
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(screen.queryByTestId('scan-error')).not.toBeInTheDocument()

    hidePage(false)
    await waitFor(() => expect(readBarcodes).toHaveBeenCalled())
    expect(screen.queryByTestId('scan-error')).not.toBeInTheDocument()
  })

  it('fires nothing when closed while a frame is decoding', async () => {
    mockCamera()
    const decoding = deferred()
    readBarcodes.mockImplementationOnce(() => decoding.promise)
    const onDecoded = vi.fn()
    const onClose = vi.fn()
    const { unmount } = renderWithProviders(<BarcodeScannerModal onDecoded={onDecoded} onClose={onClose} />)
    await waitFor(() => expect(readBarcodes).toHaveBeenCalled())

    unmount()
    decoding.resolve([{ text: '0109506000134376' }])
    await flush()

    expect(onDecoded).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(readBarcodes).toHaveBeenCalledTimes(1)
  })
})

describe('BarcodeScannerModal — enter it by hand', () => {
  it('offers no way out when the caller does not ask for one, live or on error', async () => {
    mockCamera()
    const { unmount } = renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(readBarcodes).toHaveBeenCalled())
    expect(screen.queryByTestId('scan-manual-fallback')).not.toBeInTheDocument()
    unmount()

    mockCameraFailure('NotFoundError')
    renderWithProviders(<BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByTestId('scan-error')).toBeInTheDocument()
    expect(screen.queryByTestId('scan-manual-fallback')).not.toBeInTheDocument()
  })

  it('offers it under the error message, and hands over without closing', async () => {
    mockCameraFailure('NotAllowedError')
    const onManual = vi.fn()
    const onClose = vi.fn()
    const { user } = renderWithProviders(
      <BarcodeScannerModal onDecoded={vi.fn()} onClose={onClose} onManual={onManual} />,
    )

    // The live view renders first; wait for the error panel that replaces it.
    await screen.findByTestId('scan-error')
    const button = screen.getByTestId('scan-manual-fallback')
    expect(button).toHaveTextContent('Enter it by hand')
    await user.click(button)

    expect(onManual).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('offers it while the camera is running, and hands over without closing', async () => {
    mockCamera()
    const onManual = vi.fn()
    const onClose = vi.fn()
    const { user } = renderWithProviders(
      <BarcodeScannerModal onDecoded={vi.fn()} onClose={onClose} onManual={onManual} notice="Code not recognised" />,
    )
    await waitFor(() => expect(readBarcodes).toHaveBeenCalled())
    expect(screen.getByTestId('scan-video')).toBeInTheDocument()

    await user.click(screen.getByTestId('scan-manual-fallback'))

    expect(onManual).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('releases the camera when the caller closes it after the hand-over', async () => {
    mockCamera()
    const { user, unmount } = renderWithProviders(
      <BarcodeScannerModal onDecoded={vi.fn()} onClose={vi.fn()} onManual={() => unmount()} />,
    )
    await waitFor(() => expect(readBarcodes).toHaveBeenCalled())

    await user.click(screen.getByTestId('scan-manual-fallback'))

    await waitFor(() => tracks.forEach((track) => expect(track.stop).toHaveBeenCalled()))
  })
})
