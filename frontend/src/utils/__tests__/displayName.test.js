import { describe, expect, it } from 'vitest'
import { avatarInitial, displayLabel, fullName } from '../displayName'

describe('fullName', () => {
  it('combines first_name and last_name when both are present', () => {
    expect(fullName({ first_name: 'Cibran', last_name: 'Docampo', username: 'cibran' })).toBe('Cibran Docampo')
  })

  it('uses only first_name when last_name is missing', () => {
    expect(fullName({ first_name: 'María', username: 'maria' })).toBe('María')
  })

  it('uses only last_name when first_name is missing', () => {
    expect(fullName({ last_name: 'González', username: 'maria' })).toBe('González')
  })

  it('falls back to username when no name parts are present', () => {
    expect(fullName({ username: 'admin' })).toBe('admin')
  })

  it('returns empty string for nullish input', () => {
    expect(fullName(null)).toBe('')
    expect(fullName(undefined)).toBe('')
  })
})

describe('displayLabel', () => {
  it('renders "First Last (username)" when full name exists', () => {
    expect(displayLabel({ first_name: 'María', last_name: 'González', username: 'maria' })).toBe(
      'María González (maria)',
    )
  })

  it('renders "First (username)" when only first_name', () => {
    expect(displayLabel({ first_name: 'Cibran', username: 'cibran' })).toBe('Cibran (cibran)')
  })

  it('renders just username when no name parts', () => {
    expect(displayLabel({ username: 'admin' })).toBe('admin')
  })

  it('returns empty string for nullish input', () => {
    expect(displayLabel(null)).toBe('')
  })
})

describe('avatarInitial', () => {
  it('returns the uppercased first letter of first_name when present', () => {
    expect(avatarInitial({ first_name: 'maría', username: 'maria' })).toBe('M')
  })

  it('falls back to the first letter of username when first_name is missing', () => {
    expect(avatarInitial({ username: 'admin' })).toBe('A')
  })

  it('returns "?" when neither first_name nor username are available', () => {
    expect(avatarInitial({})).toBe('?')
  })

  it('returns "?" for nullish input', () => {
    expect(avatarInitial(null)).toBe('?')
    expect(avatarInitial(undefined)).toBe('?')
  })
})
