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

  it('translates the body.code "insufficient_stock" with the i18n key + body args', () => {
    const t = vi.fn((key, args) => `[${key}] required=${args?.required} available=${args?.available}`)
    const err = new Error('HTTP 422')
    err.status = 422
    err.body = {
      detail: 'Insufficient stock to log this routine.',
      code: 'insufficient_stock',
      required: 5,
      available: 0,
    }
    expect(errorToastMessage(err, t)).toBe('[errors.insufficientStock] required=5 available=0')
    expect(t).toHaveBeenCalledWith('errors.insufficientStock', err.body)
  })

  it('falls back to body.detail when the code is unknown but a detail string exists', () => {
    const t = vi.fn((key) => key)
    const err = new Error('HTTP 400')
    err.body = { detail: 'Invalid stock item.', code: 'unknown_code_not_in_map' }
    expect(errorToastMessage(err, t)).toBe('Invalid stock item.')
  })

  it('falls back to body.detail when the body has no code at all', () => {
    const t = vi.fn((key) => key)
    const err = new Error('HTTP 400')
    err.body = { detail: 'Cannot be in the future.' }
    expect(errorToastMessage(err, t)).toBe('Cannot be in the future.')
  })

  it('falls back to fallbackKey when body has no detail string and no recognised code', () => {
    const t = vi.fn((key) => key)
    const err = new Error('HTTP 500')
    err.body = { code: 'mystery' }
    expect(errorToastMessage(err, t)).toBe('common.actionError')
  })
})
