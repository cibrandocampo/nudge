import { describe, expect, it, vi } from 'vitest'
import { OfflineError } from '../../api/errors'
import { errorToastMessage } from '../errors'

describe('errorToastMessage', () => {
  it('returns the offline message when the error is an OfflineError', () => {
    const t = vi.fn((key) => key)
    expect(errorToastMessage(new OfflineError(), t)).toBe('offline.actionUnavailable')
    expect(t).toHaveBeenCalledWith('offline.actionUnavailable')
  })

  it('returns the default fallback for any non-OfflineError', () => {
    const t = vi.fn((key) => key)
    expect(errorToastMessage(new Error('boom'), t)).toBe('common.actionError')
    expect(t).toHaveBeenCalledWith('common.actionError')
  })

  it('uses the provided fallbackKey when not an OfflineError', () => {
    const t = vi.fn((key) => key)
    expect(errorToastMessage(new Error('save failed'), t, 'settings.errorSave')).toBe('settings.errorSave')
    expect(t).toHaveBeenCalledWith('settings.errorSave')
  })

  it('still returns the offline message when fallbackKey is provided but error is offline', () => {
    const t = vi.fn((key) => key)
    expect(errorToastMessage(new OfflineError(), t, 'settings.errorSave')).toBe('offline.actionUnavailable')
  })
})
