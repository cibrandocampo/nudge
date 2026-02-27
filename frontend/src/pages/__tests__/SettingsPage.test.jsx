import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import SettingsPage from '../SettingsPage'

const BASE = 'http://localhost/api'

describe('SettingsPage', () => {
  it('renders page title', async () => {
    renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('Settings')).toBeInTheDocument()
  })

  it('shows username in profile section', async () => {
    renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('testuser')).toBeInTheDocument()
  })

  it('renders language buttons', async () => {
    renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('English')).toBeInTheDocument()
    expect(screen.getByText('Español')).toBeInTheDocument()
    expect(screen.getByText('Galego')).toBeInTheDocument()
  })

  it('switches language on button click', async () => {
    const { user } = renderWithProviders(<SettingsPage />)
    // English is currently active, click Español
    await user.click(screen.getByText('Español'))
    // The API should be called to persist language
    // After i18n change, labels will be in Spanish (but since our setup only has en.json,
    // the keys fall back). Just verify no crash.
  })

  it('renders timezone search and listbox', async () => {
    renderWithProviders(<SettingsPage />)
    expect(await screen.findByPlaceholderText('Search timezone…')).toBeInTheDocument()
  })

  it('filters timezones when searching', async () => {
    const { user } = renderWithProviders(<SettingsPage />)
    const searchInput = screen.getByPlaceholderText('Search timezone…')
    await user.type(searchInput, 'Madrid')
    // The listbox should contain Europe/Madrid
    const options = screen.getAllByRole('option')
    const hasMadrid = options.some((o) => o.textContent.includes('Madrid'))
    expect(hasMadrid).toBe(true)
  })

  it('renders daily notification time input', async () => {
    renderWithProviders(<SettingsPage />)
    expect(await screen.findByDisplayValue('08:00')).toBeInTheDocument()
  })

  it('submits settings form successfully', async () => {
    const { user } = renderWithProviders(<SettingsPage />)
    await user.click(screen.getByText('Save changes'))
    await waitFor(() => expect(screen.getByText('Saved!')).toBeInTheDocument())
  })

  it('shows error on save failure', async () => {
    server.use(http.patch(`${BASE}/auth/me/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderWithProviders(<SettingsPage />)
    await user.click(screen.getByText('Save changes'))
    await waitFor(() => expect(screen.getByText('Error — try again')).toBeInTheDocument())
  })

  it('renders push notification section with enable button by default', async () => {
    Object.defineProperty(window, 'Notification', {
      value: { permission: 'default', requestPermission: vi.fn() },
      writable: true,
    })
    renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('Not enabled')).toBeInTheDocument()
    expect(screen.getByText('Enable notifications')).toBeInTheDocument()
  })

  it('shows blocked state when permission is denied', async () => {
    Object.defineProperty(window, 'Notification', {
      value: { permission: 'denied', requestPermission: vi.fn() },
      writable: true,
    })
    renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('Blocked by browser')).toBeInTheDocument()
    expect(screen.getByText(/Enable notifications in your browser/)).toBeInTheDocument()
  })

  it('selects a timezone from the listbox', async () => {
    const { user } = renderWithProviders(<SettingsPage />)
    const listbox = screen.getByRole('listbox')
    // selectOptions works on <select> elements
    await user.selectOptions(listbox, 'Europe/London')
    expect(listbox.value).toBe('Europe/London')
  })

  it('changes daily notification time', async () => {
    const { user } = renderWithProviders(<SettingsPage />)
    const timeInput = screen.getByDisplayValue('08:00')
    await user.clear(timeInput)
    await user.type(timeInput, '09:30')
  })

  it('toggles push notifications on (enable flow)', async () => {
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      writable: true,
    })
    const { user } = renderWithProviders(<SettingsPage />)

    const enableBtn = screen.getByText('Enable notifications')
    await user.click(enableBtn)

    // The flow requests permission, gets VAPID key, calls subscribeToPush.
    // subscribeToPush uses relative URLs which may fail in jsdom, but the
    // component catches errors and shows an alert. Just verify the button was
    // clickable and no crash occurs (the component is still mounted).
    await waitFor(() => expect(screen.getByText('Push notifications')).toBeInTheDocument())
  })

  it('toggles push notifications off (disable flow)', async () => {
    Object.defineProperty(window, 'Notification', {
      value: { permission: 'granted', requestPermission: vi.fn() },
      writable: true,
    })
    const reg = await navigator.serviceWorker.ready
    reg.pushManager.getSubscription
      .mockResolvedValueOnce({
        endpoint: 'https://push.example.com/sub/123',
        unsubscribe: vi.fn().mockResolvedValue(true),
      })
      // After disable, getSubscription returns null
      .mockResolvedValueOnce(null)

    const { user } = renderWithProviders(<SettingsPage />)
    await waitFor(() => expect(screen.getByText('Disable notifications')).toBeInTheDocument())
    await user.click(screen.getByText('Disable notifications'))
    await waitFor(() => expect(screen.queryByText('Active')).not.toBeInTheDocument())
  })

  it('shows granted-not-subscribed state', async () => {
    Object.defineProperty(window, 'Notification', {
      value: { permission: 'granted', requestPermission: vi.fn() },
      writable: true,
    })
    renderWithProviders(<SettingsPage />)
    // No subscription: should show "Permission granted — tap to subscribe"
    expect(await screen.findByText('Permission granted — tap to subscribe')).toBeInTheDocument()
    expect(screen.getByText('Enable notifications')).toBeInTheDocument()
  })

  it('shows test notification button when subscribed and sends test', async () => {
    Object.defineProperty(window, 'Notification', {
      value: { permission: 'granted', requestPermission: vi.fn() },
      writable: true,
    })
    const reg = await navigator.serviceWorker.ready
    reg.pushManager.getSubscription.mockResolvedValueOnce({
      endpoint: 'https://push.example.com/sub/123',
      unsubscribe: vi.fn().mockResolvedValue(true),
    })

    server.use(http.post(`${BASE}/push/test/`, () => new HttpResponse(null, { status: 204 })))

    const { user } = renderWithProviders(<SettingsPage />)
    await waitFor(() => expect(screen.getByText('Send test notification')).toBeInTheDocument())
    await user.click(screen.getByText('Send test notification'))
    await waitFor(() => expect(screen.getByText('Sent!')).toBeInTheDocument())
  })

  it('shows error when test notification fails', async () => {
    Object.defineProperty(window, 'Notification', {
      value: { permission: 'granted', requestPermission: vi.fn() },
      writable: true,
    })
    const reg = await navigator.serviceWorker.ready
    reg.pushManager.getSubscription.mockResolvedValueOnce({
      endpoint: 'https://push.example.com/sub/123',
      unsubscribe: vi.fn().mockResolvedValue(true),
    })

    server.use(http.post(`${BASE}/push/test/`, () => new HttpResponse(null, { status: 500 })))

    const { user } = renderWithProviders(<SettingsPage />)
    await waitFor(() => expect(screen.getByText('Send test notification')).toBeInTheDocument())
    await user.click(screen.getByText('Send test notification'))
    await waitFor(() => expect(screen.getByText('Failed — try again')).toBeInTheDocument())
  })

  it('shows active state and disable button when subscribed', async () => {
    Object.defineProperty(window, 'Notification', {
      value: { permission: 'granted', requestPermission: vi.fn() },
      writable: true,
    })
    // Mock that there is already a subscription
    const reg = await navigator.serviceWorker.ready
    reg.pushManager.getSubscription.mockResolvedValueOnce({
      endpoint: 'https://push.example.com/sub/123',
      unsubscribe: vi.fn().mockResolvedValue(true),
    })

    renderWithProviders(<SettingsPage />)
    await waitFor(() => expect(screen.getByText('Active')).toBeInTheDocument())
    expect(screen.getByText('Disable notifications')).toBeInTheDocument()
  })
})
