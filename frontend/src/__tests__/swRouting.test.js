import { describe, expect, it } from 'vitest'
import { notificationTargetUrl } from '../swRouting'

describe('notificationTargetUrl', () => {
  it('opens a routine, as before', () => {
    expect(notificationTargetUrl({ routine_id: 5 })).toBe('/routines/5')
  })

  it('marks a routine done from its action, as before', () => {
    expect(notificationTargetUrl({ routine_id: 5 }, 'mark-done')).toBe('/routines/5?action=mark-done')
  })

  it('a dismiss action on a routine still opens it, as before', () => {
    expect(notificationTargetUrl({ routine_id: 5 }, 'dismiss')).toBe('/routines/5')
  })

  it('opens the product of a one-product digest', () => {
    expect(notificationTargetUrl({ stock_id: 42 })).toBe('/inventory/42')
  })

  it('opens an in-app path', () => {
    expect(notificationTargetUrl({ path: '/inventory' })).toBe('/inventory')
  })

  it('never follows a protocol-relative path to another site', () => {
    expect(notificationTargetUrl({ path: '//evil.com' })).toBe('/')
  })

  it('ignores a path without a leading slash', () => {
    expect(notificationTargetUrl({ path: 'https://evil.com/x' })).toBe('/')
    expect(notificationTargetUrl({ path: 'inventory' })).toBe('/')
  })

  it('opens the app with nothing to go on', () => {
    expect(notificationTargetUrl({})).toBe('/')
    expect(notificationTargetUrl(undefined)).toBe('/')
    expect(notificationTargetUrl({}, 'mark-done')).toBe('/')
    expect(notificationTargetUrl({ path: 42 })).toBe('/')
  })
})
