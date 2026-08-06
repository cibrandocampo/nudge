const STORAGE_KEY = 'scanner_camera_id'

/**
 * The lens that last produced a successful scan on this device.
 *
 * No heuristic can tell which rear camera focuses on a millimetre-wide symbol:
 * `InputDeviceInfo.getCapabilities()` reports resolution and facing mode but
 * nothing optical, and on a Galaxy S23+ the lens that works and the one that
 * cannot focus differ by 2% in sensor size. A completed scan, on the other
 * hand, is proof — so remember it and open there next time.
 *
 * Stored per browser, keyed by `deviceId`. That id is stable for an origin
 * while permission is held, but not forever: clearing site data or revoking
 * the permission mints a new one. So the caller must check the remembered id
 * against the devices actually present and fall back when it has gone stale.
 */
export function rememberScannerCamera(deviceId) {
  if (!deviceId) return
  try {
    localStorage.setItem(STORAGE_KEY, deviceId)
  } catch {
    // Storage disabled (private mode, blocked cookies): the picker still works,
    // it just cannot carry the choice to the next session.
  }
}

export function readScannerCamera() {
  try {
    return localStorage.getItem(STORAGE_KEY) || null
  } catch {
    return null
  }
}
