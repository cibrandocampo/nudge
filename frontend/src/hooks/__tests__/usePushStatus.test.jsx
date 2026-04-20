import { act, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { usePushStatus } from '../usePushStatus'

function setNotification(permission) {
  Object.defineProperty(window, 'Notification', {
    value: { permission, requestPermission: vi.fn() },
    writable: true,
  })
}

describe('usePushStatus', () => {
  it('returns active=false when permission is not granted', async () => {
    setNotification('default')
    const reg = await navigator.serviceWorker.ready
    reg.pushManager.getSubscription.mockResolvedValueOnce(null)

    const { result } = renderHook(() => usePushStatus())

    await waitFor(() => expect(result.current.permission).toBe('default'))
    expect(result.current.subscribed).toBe(false)
    expect(result.current.active).toBe(false)
  })

  it('returns active=true when permission is granted and a subscription exists', async () => {
    setNotification('granted')
    const reg = await navigator.serviceWorker.ready
    reg.pushManager.getSubscription.mockResolvedValue({
      endpoint: 'https://push.example.com/sub/123',
      unsubscribe: vi.fn(),
    })

    const { result } = renderHook(() => usePushStatus())

    await waitFor(() => expect(result.current.active).toBe(true))
    expect(result.current.permission).toBe('granted')
    expect(result.current.subscribed).toBe(true)
  })

  it('re-reads permission and subscription on window focus', async () => {
    setNotification('default')
    const reg = await navigator.serviceWorker.ready
    reg.pushManager.getSubscription.mockResolvedValueOnce(null)

    const { result } = renderHook(() => usePushStatus())
    await waitFor(() => expect(result.current.active).toBe(false))

    setNotification('granted')
    reg.pushManager.getSubscription.mockResolvedValueOnce({
      endpoint: 'https://push.example.com/sub/456',
      unsubscribe: vi.fn(),
    })

    await act(async () => {
      fireEvent.focus(window)
    })

    await waitFor(() => expect(result.current.active).toBe(true))
    expect(result.current.permission).toBe('granted')
    expect(result.current.subscribed).toBe(true)
  })

  it('treats a failing getSubscription as not subscribed', async () => {
    setNotification('granted')
    const reg = await navigator.serviceWorker.ready
    reg.pushManager.getSubscription.mockRejectedValueOnce(new Error('sw offline'))

    const { result } = renderHook(() => usePushStatus())

    await waitFor(() => expect(result.current.subscribed).toBe(false))
    expect(result.current.active).toBe(false)
  })

  it('exposes setters so callers can reflect toggle actions immediately', async () => {
    setNotification('default')
    const reg = await navigator.serviceWorker.ready
    reg.pushManager.getSubscription.mockResolvedValue(null)

    const { result } = renderHook(() => usePushStatus())
    await waitFor(() => expect(result.current.permission).toBe('default'))

    act(() => {
      result.current.setPermission('granted')
      result.current.setSubscribed(true)
    })

    expect(result.current.active).toBe(true)
  })

  it('falls back to default permission when Notification API is unavailable', async () => {
    const original = window.Notification
    // Simulate a browser without the Notification API (e.g. some Safari PWAs).
    delete window.Notification
    try {
      const { result } = renderHook(() => usePushStatus())
      await waitFor(() => expect(result.current.permission).toBe('default'))
      expect(result.current.active).toBe(false)
    } finally {
      window.Notification = original
    }
  })
})
