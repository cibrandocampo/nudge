import cx from '../cx'

describe('cx', () => {
  it('returns empty string with no args', () => {
    expect(cx()).toBe('')
  })

  it('joins multiple strings', () => {
    expect(cx('a', 'b', 'c')).toBe('a b c')
  })

  it('filters out falsy values', () => {
    expect(cx('a', false, null, undefined, 0, '', 'b')).toBe('a b')
  })

  it('handles a single string', () => {
    expect(cx('only')).toBe('only')
  })

  it('handles conditional class patterns', () => {
    const isActive = true
    const isHidden = false
    expect(cx('base', isActive && 'active', isHidden && 'hidden')).toBe('base active')
  })
})
