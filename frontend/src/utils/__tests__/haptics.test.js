import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REFUSED_PATTERN, vibrateIfOutOfStock, vibrateRefused } from '../haptics'

describe('haptics', () => {
  beforeEach(() => {
    navigator.vibrate = vi.fn()
  })

  afterEach(() => {
    delete navigator.vibrate
  })

  it('buzzes the refused pattern', () => {
    vibrateRefused()
    expect(navigator.vibrate).toHaveBeenCalledWith(REFUSED_PATTERN)
  })

  it('stays silent with reduced motion', () => {
    window.matchMedia.mockReturnValueOnce({ matches: true })
    vibrateRefused()
    expect(navigator.vibrate).not.toHaveBeenCalled()
  })

  it('does nothing where the device cannot vibrate', () => {
    delete navigator.vibrate
    expect(() => vibrateRefused()).not.toThrow()
  })

  it('buzzes when the server refuses for lack of stock', () => {
    vibrateIfOutOfStock({ body: { code: 'insufficient_stock' } })
    expect(navigator.vibrate).toHaveBeenCalledTimes(1)
  })

  it.each([[{ body: { code: 'lot_expired' } }], [new Error('network')], [undefined]])(
    'stays silent for any other error',
    (error) => {
      vibrateIfOutOfStock(error)
      expect(navigator.vibrate).not.toHaveBeenCalled()
    },
  )
})
