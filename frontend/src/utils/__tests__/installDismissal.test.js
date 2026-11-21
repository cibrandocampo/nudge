import { afterEach, describe, expect, it, vi } from 'vitest'
import { dismissInstall, isInstallDismissed } from '../installDismissal'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem('nudge.installDismissed')
})

describe('installDismissal', () => {
  it('is not dismissed until the × is pressed, and stays dismissed after', () => {
    expect(isInstallDismissed()).toBe(false)
    dismissInstall()
    expect(isInstallDismissed()).toBe(true)
  })

  it('reads «not dismissed» when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(isInstallDismissed()).toBe(false)
  })

  it('does not throw when storage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => dismissInstall()).not.toThrow()
  })
})
