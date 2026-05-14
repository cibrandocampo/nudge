import { describe, expect, it } from 'vitest'
import { avatarInitial, displayLabel, fullName } from '../displayName'

// Post-T195 the helpers fall back to `email`, never `username` — username
// is an internal-only identifier that the frontend never renders.

describe('fullName', () => {
  it('combines first_name and last_name when both are present', () => {
    expect(fullName({ first_name: 'Cibran', last_name: 'Docampo', email: 'c@x.com' })).toBe('Cibran Docampo')
  })

  it('uses only first_name when last_name is missing', () => {
    expect(fullName({ first_name: 'María', email: 'maria@x.com' })).toBe('María')
  })

  it('uses only last_name when first_name is missing', () => {
    expect(fullName({ last_name: 'González', email: 'maria@x.com' })).toBe('González')
  })

  it('falls back to email when no name parts are present', () => {
    expect(fullName({ email: 'admin@example.com' })).toBe('admin@example.com')
  })

  it('returns empty string when neither names nor email are available', () => {
    expect(fullName({})).toBe('')
  })

  it('returns empty string for nullish input', () => {
    expect(fullName(null)).toBe('')
    expect(fullName(undefined)).toBe('')
  })

  it('ignores `username` even when present (no longer a fallback)', () => {
    expect(fullName({ username: 'admin' })).toBe('')
  })
})

describe('displayLabel', () => {
  it('is identical to fullName — the "(username)" suffix is gone', () => {
    expect(displayLabel({ first_name: 'María', last_name: 'González', email: 'm@x.com' })).toBe('María González')
  })

  it('renders the email fallback when no name parts', () => {
    expect(displayLabel({ email: 'admin@example.com' })).toBe('admin@example.com')
  })

  it('returns empty string for nullish input', () => {
    expect(displayLabel(null)).toBe('')
  })
})

describe('avatarInitial', () => {
  it('returns the uppercased first letter of first_name when present', () => {
    expect(avatarInitial({ first_name: 'maría', email: 'm@x.com' })).toBe('M')
  })

  it('falls back to the first letter of email when first_name is missing', () => {
    expect(avatarInitial({ email: 'admin@example.com' })).toBe('A')
  })

  it('returns "?" when neither first_name nor email are available', () => {
    expect(avatarInitial({})).toBe('?')
  })

  it('returns "?" for nullish input', () => {
    expect(avatarInitial(null)).toBe('?')
    expect(avatarInitial(undefined)).toBe('?')
  })
})
