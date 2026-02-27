import { subscribeToPush, unsubscribeFromPush } from '../push'
import { server } from '../../test/mocks/server'

// push.js uses hardcoded relative URLs (/api/push/...) with raw fetch,
// which fail in jsdom. We need to temporarily close the MSW server and
// mock fetch directly for these tests.
beforeAll(() => {
  server.close()
})
afterAll(() => {
  server.listen()
})

const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('subscribeToPush', () => {
  it('subscribes and POSTs to backend', async () => {
    localStorage.setItem('access_token', 'tok')
    await subscribeToPush('BFake-VAPID-Key')
    const call = mockFetch.mock.calls.find(([url]) => url.includes('/api/push/subscribe/'))
    expect(call).toBeTruthy()
    expect(call[1].method).toBe('POST')
  })

  it('sends auth header with token', async () => {
    localStorage.setItem('access_token', 'my-token')
    await subscribeToPush('BFake-VAPID-Key')
    const call = mockFetch.mock.calls.find(([url]) => url.includes('/api/push/subscribe/'))
    expect(call).toBeTruthy()
    expect(call[1].headers.Authorization).toBe('Bearer my-token')
  })

  it('sends subscription keys in body', async () => {
    localStorage.setItem('access_token', 'tok')
    await subscribeToPush('BFake-VAPID-Key')
    const call = mockFetch.mock.calls.find(([url]) => url.includes('/api/push/subscribe/'))
    const body = JSON.parse(call[1].body)
    expect(body).toHaveProperty('endpoint')
    expect(body).toHaveProperty('keys')
    expect(body.keys).toHaveProperty('p256dh')
    expect(body.keys).toHaveProperty('auth')
  })

  it('calls pushManager.subscribe with VAPID key', async () => {
    localStorage.setItem('access_token', 'tok')
    const reg = await navigator.serviceWorker.ready
    await subscribeToPush('BFake-VAPID-Key')
    expect(reg.pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }))
  })
})

describe('unsubscribeFromPush', () => {
  it('is a no-op when no subscription exists', async () => {
    await unsubscribeFromPush()
    const call = mockFetch.mock.calls.find(([url]) => typeof url === 'string' && url.includes('/api/push/unsubscribe/'))
    expect(call).toBeUndefined()
  })

  it('calls DELETE and unsubscribes when subscription exists', async () => {
    const mockUnsub = vi.fn().mockResolvedValue(true)
    const mockSub = {
      endpoint: 'https://push.example.com/sub/123',
      unsubscribe: mockUnsub,
    }
    const reg = await navigator.serviceWorker.ready
    reg.pushManager.getSubscription.mockResolvedValueOnce(mockSub)

    localStorage.setItem('access_token', 'tok')
    await unsubscribeFromPush()

    const call = mockFetch.mock.calls.find(([url]) => url.includes('/api/push/unsubscribe/'))
    expect(call).toBeTruthy()
    expect(call[1].method).toBe('DELETE')
    expect(mockUnsub).toHaveBeenCalled()
  })

  it('sends endpoint in body when unsubscribing', async () => {
    const mockSub = {
      endpoint: 'https://push.example.com/sub/456',
      unsubscribe: vi.fn().mockResolvedValue(true),
    }
    const reg = await navigator.serviceWorker.ready
    reg.pushManager.getSubscription.mockResolvedValueOnce(mockSub)

    localStorage.setItem('access_token', 'tok')
    await unsubscribeFromPush()

    const call = mockFetch.mock.calls.find(([url]) => url.includes('/api/push/unsubscribe/'))
    const body = JSON.parse(call[1].body)
    expect(body.endpoint).toBe('https://push.example.com/sub/456')
  })
})
