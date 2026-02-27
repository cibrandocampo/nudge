import { getAccessToken } from '../auth'

describe('getAccessToken', () => {
  it('returns token when present', () => {
    localStorage.setItem('access_token', 'my-token')
    expect(getAccessToken()).toBe('my-token')
  })

  it('returns null when no token', () => {
    expect(getAccessToken()).toBeNull()
  })
})
