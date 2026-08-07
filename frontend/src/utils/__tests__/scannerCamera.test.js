import { afterEach, describe, expect, it, vi } from 'vitest'
import { readScannerCamera, rememberScannerCamera } from '../scannerCamera'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('scannerCamera', () => {
  it('round-trips the lens that produced a scan', () => {
    rememberScannerCamera('id-0')

    expect(readScannerCamera()).toBe('id-0')
  })

  it('reports nothing before the first successful scan', () => {
    expect(readScannerCamera()).toBeNull()
  })

  it('ignores an empty id instead of storing a useless entry', () => {
    rememberScannerCamera('id-0')
    rememberScannerCamera(undefined)

    expect(readScannerCamera()).toBe('id-0')
  })

  it('degrades quietly when storage is unavailable', () => {
    // Private mode and blocked cookies both make localStorage throw. The
    // scanner has to keep working; it just cannot remember the choice.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    expect(() => rememberScannerCamera('id-0')).not.toThrow()
    expect(readScannerCamera()).toBeNull()
  })
})
