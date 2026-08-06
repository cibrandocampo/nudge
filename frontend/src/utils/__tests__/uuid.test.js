import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUuid } from '../uuid'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const original = globalThis.crypto

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: original })
})

// `crypto.randomUUID` exists only in a secure context. Serving the app over
// plain HTTP on a LAN is supported, and there the property is simply missing —
// so every branch below is a real deployment, not a hypothetical.
function useCrypto(value) {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value })
}

describe('randomUuid', () => {
  it('uses the native generator when the context is secure', () => {
    const randomUUID = vi.fn().mockReturnValue('11111111-2222-4333-8444-555555555555')
    useCrypto({ randomUUID })

    expect(randomUuid()).toBe('11111111-2222-4333-8444-555555555555')
    expect(randomUUID).toHaveBeenCalled()
  })

  it('still returns a valid v4 uuid when randomUUID is missing', () => {
    useCrypto({ getRandomValues: original.getRandomValues.bind(original) })

    expect(randomUuid()).toMatch(UUID_V4)
  })

  it('draws from getRandomValues rather than Math.random when it is available', () => {
    const getRandomValues = vi.fn((arr) => arr.fill(7))
    useCrypto({ getRandomValues })
    const spy = vi.spyOn(Math, 'random')

    randomUuid()

    expect(getRandomValues).toHaveBeenCalled()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('survives a runtime with no Web Crypto at all', () => {
    useCrypto(undefined)

    expect(randomUuid()).toMatch(UUID_V4)
  })

  it('does not repeat itself', () => {
    useCrypto({ getRandomValues: original.getRandomValues.bind(original) })

    const ids = new Set(Array.from({ length: 500 }, randomUuid))
    expect(ids.size).toBe(500)
  })
})
