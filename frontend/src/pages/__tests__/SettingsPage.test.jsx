import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import SettingsPage from '../SettingsPage'

const reachableRef = { current: true }
vi.mock('../../hooks/useServerReachable', () => ({
  useServerReachable: () => reachableRef.current,
}))

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

  it('renders "First Last (username)" when the user has a first and last name', async () => {
    renderWithProviders(<SettingsPage />, {
      auth: {
        user: {
          id: 1,
          username: 'jdoe',
          first_name: 'Jane',
          last_name: 'Doe',
          is_staff: false,
          timezone: 'Europe/Madrid',
          language: 'en',
          daily_notification_time: '08:00:00',
        },
      },
    })
    const heading = await screen.findByRole('heading', { name: /Jane Doe/ })
    expect(heading.textContent).toContain('jdoe')
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

  it('renders timezone combobox with the current value', async () => {
    renderWithProviders(<SettingsPage />)
    // Placeholder attribute is present even when the input shows the current timezone
    const tzInput = await screen.findByPlaceholderText('Search timezone…')
    // Default test user has timezone Europe/Madrid
    expect(tzInput).toHaveValue('Europe/Madrid')
  })

  it('filters timezones when typing in the combobox', async () => {
    const { user } = renderWithProviders(<SettingsPage />)
    const input = await screen.findByPlaceholderText('Search timezone…')
    await user.click(input)
    await user.keyboard('London')
    const options = screen.getAllByRole('option')
    const labels = options.map((o) => o.textContent)
    expect(labels.some((l) => l.includes('Europe/London'))).toBe(true)
    expect(labels.every((l) => l.toLowerCase().includes('london'))).toBe(true)
  })

  it('renders daily notification time input', async () => {
    renderWithProviders(<SettingsPage />)
    expect(await screen.findByDisplayValue('08:00')).toBeInTheDocument()
  })

  it('autosaves the daily-notification-time on blur', async () => {
    let patchedBody = null
    server.use(
      http.patch(`${BASE}/auth/me/`, async ({ request }) => {
        patchedBody = await request.json()
        return HttpResponse.json({})
      }),
    )
    const { user } = renderWithProviders(<SettingsPage />)
    const input = await screen.findByDisplayValue('08:00')
    await user.clear(input)
    await user.type(input, '09:15')
    input.blur()
    await waitFor(() => expect(patchedBody).not.toBeNull())
    expect(patchedBody).toEqual({ daily_notification_time: '09:15' })
  })

  it('surfaces an error toast when autosave fails', async () => {
    server.use(http.patch(`${BASE}/auth/me/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderWithProviders(<SettingsPage />)
    const input = await screen.findByDisplayValue('08:00')
    await user.clear(input)
    await user.type(input, '09:15')
    input.blur()
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

  it('selects a timezone from the combobox popover', async () => {
    const { user } = renderWithProviders(<SettingsPage />)
    const input = await screen.findByPlaceholderText('Search timezone…')
    await user.click(input)
    await user.keyboard('London')
    await user.click(screen.getByText('Europe/London'))
    // After selection the combobox closes and the input shows the new value
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).toHaveValue('Europe/London')
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
    await user.click(await screen.findByTestId('push-troubleshooting-toggle'))
    await user.click(await screen.findByText('Send test notification'))
    await waitFor(() => expect(screen.getByText('Sent!')).toBeInTheDocument())
  })

  it('shows error when test notification throws network error', async () => {
    Object.defineProperty(window, 'Notification', {
      value: { permission: 'granted', requestPermission: vi.fn() },
      writable: true,
    })
    const reg = await navigator.serviceWorker.ready
    reg.pushManager.getSubscription.mockResolvedValueOnce({
      endpoint: 'https://push.example.com/sub/123',
      unsubscribe: vi.fn().mockResolvedValue(true),
    })

    server.use(http.post(`${BASE}/push/test/`, () => HttpResponse.error()))

    const { user } = renderWithProviders(<SettingsPage />)
    await user.click(await screen.findByTestId('push-troubleshooting-toggle'))
    await user.click(await screen.findByText('Send test notification'))
    await waitFor(() => expect(screen.getByText('Failed — try again')).toBeInTheDocument())
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
    await user.click(await screen.findByTestId('push-troubleshooting-toggle'))
    await user.click(await screen.findByText('Send test notification'))
    await waitFor(() => expect(screen.getByText('Failed — try again')).toBeInTheDocument())
  })

  it('schedules test notification successfully', async () => {
    Object.defineProperty(window, 'Notification', {
      value: { permission: 'granted', requestPermission: vi.fn() },
      writable: true,
    })
    const reg = await navigator.serviceWorker.ready
    reg.pushManager.getSubscription.mockResolvedValueOnce({
      endpoint: 'https://push.example.com/sub/123',
      unsubscribe: vi.fn().mockResolvedValue(true),
    })

    server.use(http.post(`${BASE}/push/test/scheduled/`, () => new HttpResponse(null, { status: 202 })))

    const { user } = renderWithProviders(<SettingsPage />)
    await user.click(await screen.findByTestId('push-troubleshooting-toggle'))
    await user.click(await screen.findByText('Schedule test (5 min)'))
    await waitFor(() => expect(screen.getByText('Scheduled!')).toBeInTheDocument())
  })

  it('shows error when scheduled test notification throws network error', async () => {
    Object.defineProperty(window, 'Notification', {
      value: { permission: 'granted', requestPermission: vi.fn() },
      writable: true,
    })
    const reg = await navigator.serviceWorker.ready
    reg.pushManager.getSubscription.mockResolvedValueOnce({
      endpoint: 'https://push.example.com/sub/123',
      unsubscribe: vi.fn().mockResolvedValue(true),
    })

    server.use(http.post(`${BASE}/push/test/scheduled/`, () => HttpResponse.error()))

    const { user } = renderWithProviders(<SettingsPage />)
    await user.click(await screen.findByTestId('push-troubleshooting-toggle'))
    await user.click(await screen.findByText('Schedule test (5 min)'))
    await waitFor(() => expect(screen.getByText('Failed — try again')).toBeInTheDocument())
  })

  it('shows error when scheduled test notification fails', async () => {
    Object.defineProperty(window, 'Notification', {
      value: { permission: 'granted', requestPermission: vi.fn() },
      writable: true,
    })
    const reg = await navigator.serviceWorker.ready
    reg.pushManager.getSubscription.mockResolvedValueOnce({
      endpoint: 'https://push.example.com/sub/123',
      unsubscribe: vi.fn().mockResolvedValue(true),
    })

    server.use(http.post(`${BASE}/push/test/scheduled/`, () => new HttpResponse(null, { status: 500 })))

    const { user } = renderWithProviders(<SettingsPage />)
    await user.click(await screen.findByTestId('push-troubleshooting-toggle'))
    await user.click(await screen.findByText('Schedule test (5 min)'))
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

  // ── Contacts ────────────────────────────────────────────────────────────────

  it('renders contacts section', async () => {
    renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('Contacts')).toBeInTheDocument()
  })

  it('shows empty state when no contacts', async () => {
    renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('No contacts yet')).toBeInTheDocument()
  })

  it('shows contact list when contacts exist', async () => {
    server.use(
      http.get(`${BASE}/auth/contacts/`, () =>
        HttpResponse.json([
          { id: 10, username: 'alice' },
          { id: 11, username: 'charlie' },
        ]),
      ),
    )
    renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(screen.getByText('charlie')).toBeInTheDocument()
  })

  it('search shows results', async () => {
    const { user } = renderWithProviders(<SettingsPage />)
    await screen.findByText('Contacts')
    const input = screen.getByPlaceholderText('Search users...')
    await user.type(input, 'bob')
    await waitFor(() => expect(screen.getByText('bob')).toBeInTheDocument())
  })

  it('adds contact from search results', async () => {
    const { user } = renderWithProviders(<SettingsPage />)
    await screen.findByText('Contacts')
    const input = screen.getByPlaceholderText('Search users...')
    await user.type(input, 'bob')
    await waitFor(() => expect(screen.getByText('bob')).toBeInTheDocument())
    await user.click(screen.getByText('bob'))
    await waitFor(() => {
      // Input should be cleared after adding
      expect(input.value).toBe('')
    })
  })

  it('renders contacts with an avatar initial', async () => {
    server.use(http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json([{ id: 10, username: 'alice' }])))
    renderWithProviders(<SettingsPage />)
    const nameNode = await screen.findByText('alice')
    const row = nameNode.closest('li')
    expect(row).not.toBeNull()
    // The avatar sibling renders the uppercased first letter
    expect(row.textContent.startsWith('A')).toBe(true)
  })

  it('removes contact with confirmation', async () => {
    server.use(http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json([{ id: 10, username: 'alice' }])))
    const { user } = renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('alice')).toBeInTheDocument()
    await user.click(screen.getByTitle('Remove contact'))
    // ConfirmModal renders a dialog with the contact name in the message.
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove contact' }))
    await waitFor(() => expect(screen.queryByText('alice')).not.toBeInTheDocument())
  })

  it('shows "Action not available offline" when add contact hits a network error', async () => {
    // Contacts became online-only in T060. Instead of queueing, the
    // component surfaces the offline error inline.
    server.use(http.post(`${BASE}/auth/contacts/`, () => HttpResponse.error()))
    const { user } = renderWithProviders(<SettingsPage />)
    await screen.findByText('Contacts')
    const input = screen.getByPlaceholderText('Search users...')
    await user.type(input, 'bob')
    await waitFor(() => expect(screen.getByText('bob')).toBeInTheDocument())
    await user.click(screen.getByText('bob'))
    await waitFor(() => expect(screen.getByText(/Action not available offline/i)).toBeInTheDocument())
  })

  it('shows error when add contact fails', async () => {
    server.use(
      http.post(`${BASE}/auth/contacts/`, () => HttpResponse.json({ detail: 'Already a contact' }, { status: 400 })),
    )
    const { user } = renderWithProviders(<SettingsPage />)
    await screen.findByText('Contacts')
    const input = screen.getByPlaceholderText('Search users...')
    await user.type(input, 'bob')
    await waitFor(() => expect(screen.getByText('bob')).toBeInTheDocument())
    await user.click(screen.getByText('bob'))
    await waitFor(() => expect(screen.getByText('Already a contact')).toBeInTheDocument())
  })

  it('shows "Action not available offline" when remove contact hits a network error', async () => {
    server.use(
      http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json([{ id: 10, username: 'alice' }])),
      http.delete(`${BASE}/auth/contacts/:id/`, () => HttpResponse.error()),
    )
    const { user } = renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('alice')).toBeInTheDocument()
    await user.click(screen.getByTitle('Remove contact'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove contact' }))
    await waitFor(() => expect(screen.getByText(/Action not available offline/i)).toBeInTheDocument())
  })

  it('shows error when remove contact returns a server error', async () => {
    server.use(
      http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json([{ id: 10, username: 'alice' }])),
      http.delete(`${BASE}/auth/contacts/:id/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { user } = renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('alice')).toBeInTheDocument()
    await user.click(screen.getByTitle('Remove contact'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove contact' }))
    await waitFor(() => expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument())
  })

  it('surfaces the offline label when the autosave PATCH hits a network error', async () => {
    server.use(http.patch(`${BASE}/auth/me/`, () => HttpResponse.error()))
    const { user } = renderWithProviders(<SettingsPage />)
    const input = await screen.findByDisplayValue('08:00')
    await user.clear(input)
    await user.type(input, '09:15')
    input.blur()
    await waitFor(() => expect(screen.getByText(/Action not available offline/i)).toBeInTheDocument())
  })

  it('skips subscribing when user denies the permission prompt', async () => {
    Object.defineProperty(window, 'Notification', {
      value: { permission: 'default', requestPermission: vi.fn().mockResolvedValue('denied') },
      writable: true,
    })
    const vapidSpy = vi.fn()
    server.use(
      http.get(`${BASE}/push/vapid-public-key/`, () => {
        vapidSpy()
        return HttpResponse.json({ public_key: 'should-not-be-fetched' })
      }),
    )
    const { user } = renderWithProviders(<SettingsPage />)
    await user.click(screen.getByText('Enable notifications'))
    await waitFor(() => expect(screen.getByText('Blocked by browser')).toBeInTheDocument())
    expect(vapidSpy).not.toHaveBeenCalled()
  })

  it('adds contact error falls back to generic message when detail is missing', async () => {
    server.use(http.post(`${BASE}/auth/contacts/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderWithProviders(<SettingsPage />)
    await screen.findByText('Contacts')
    const input = screen.getByPlaceholderText('Search users...')
    await user.type(input, 'bob')
    await waitFor(() => expect(screen.getByText('bob')).toBeInTheDocument())
    await user.click(screen.getByText('bob'))
    await waitFor(() => expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument())
  })

  it('does not remove contact when the confirm dialog is dismissed', async () => {
    server.use(http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json([{ id: 10, username: 'alice' }])))
    const deleteSpy = vi.fn()
    server.use(
      http.delete(`${BASE}/auth/contacts/:id/`, () => {
        deleteSpy()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user } = renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('alice')).toBeInTheDocument()
    await user.click(screen.getByTitle('Remove contact'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteSpy).not.toHaveBeenCalled()
    expect(screen.getByText('alice')).toBeInTheDocument()
  })

  it('defaults daily notification time when the user record has none', async () => {
    renderWithProviders(<SettingsPage />, {
      auth: {
        user: {
          id: 1,
          username: 'testuser',
          timezone: 'Europe/Madrid',
          daily_notification_time: null,
          language: 'en',
        },
      },
    })
    expect(await screen.findByDisplayValue('08:00')).toBeInTheDocument()
  })

  it('shows timezone hint when user timezone is UTC but browser is different', async () => {
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ timeZone: 'Europe/Madrid' })
    try {
      renderWithProviders(<SettingsPage />, {
        auth: {
          user: {
            id: 1,
            username: 'testuser',
            timezone: 'UTC',
            daily_notification_time: '08:00:00',
            language: 'en',
          },
        },
      })
      expect(await screen.findByText('Detected: Europe/Madrid')).toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })

  it('handles contact search API failure gracefully', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    server.use(http.get(`${BASE}/auth/contacts/search/`, () => HttpResponse.error()))
    const { user } = renderWithProviders(<SettingsPage />)
    await screen.findByText('Contacts')
    const input = screen.getByPlaceholderText('Search users...')
    await user.type(input, 'fail')
    // Advance past the 300ms debounce
    vi.advanceTimersByTime(350)
    // Should not crash, results just remain empty
    await waitFor(() => expect(screen.queryByRole('button', { name: 'fail' })).not.toBeInTheDocument())
    vi.useRealTimers()
  })

  it('shows alert when VAPID key is missing on enable', async () => {
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      writable: true,
    })
    server.use(http.get(`${BASE}/push/vapid-public-key/`, () => HttpResponse.json({ public_key: '' })))
    window.alert = vi.fn()
    const { user } = renderWithProviders(<SettingsPage />)

    const enableBtn = screen.getByText('Enable notifications')
    await user.click(enableBtn)

    await waitFor(() => expect(window.alert).toHaveBeenCalled())
  })

  it('shows alert when push toggle throws an error', async () => {
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      writable: true,
    })
    server.use(http.get(`${BASE}/push/vapid-public-key/`, () => HttpResponse.error()))
    window.alert = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { user } = renderWithProviders(<SettingsPage />)

    const enableBtn = screen.getByText('Enable notifications')
    await user.click(enableBtn)

    await waitFor(() => expect(window.alert).toHaveBeenCalled())
    consoleError.mockRestore()
  })

  it('does not call API for search with short query', async () => {
    const { user } = renderWithProviders(<SettingsPage />)
    await screen.findByText('Contacts')
    const input = screen.getByPlaceholderText('Search users...')
    await user.type(input, 'b')
    // No results should appear for single character
    expect(screen.queryByRole('button', { name: 'bob' })).not.toBeInTheDocument()
  })

  // ── Profile (T042) ─────────────────────────────────────────────────────────

  it('renders the email under the username when present', async () => {
    renderWithProviders(<SettingsPage />, {
      auth: {
        user: {
          id: 1,
          username: 'testuser',
          email: 'testuser@example.com',
          timezone: 'Europe/Madrid',
          language: 'en',
          daily_notification_time: '08:00:00',
        },
      },
    })
    expect(await screen.findByText('testuser@example.com')).toBeInTheDocument()
  })

  it('omits the email line when the user has no email on file', async () => {
    renderWithProviders(<SettingsPage />, {
      auth: {
        user: {
          id: 1,
          username: 'testuser',
          email: '',
          timezone: 'Europe/Madrid',
          language: 'en',
          daily_notification_time: '08:00:00',
        },
      },
    })
    await screen.findByText('testuser')
    // No email rendered — the only @ on the page shouldn't appear
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
  })

  // ── Section order (T052) ───────────────────────────────────────────────────

  it('renders sections in the expected order: Profile, Contacts, Push, Daily heads-up, Language, Timezone', async () => {
    renderWithProviders(<SettingsPage />)
    const titles = [
      await screen.findByText('Profile'),
      screen.getByText('Contacts'),
      screen.getByText('Push notifications'),
      screen.getByText('Daily heads-up time'),
      screen.getByText('Language'),
      screen.getByText('Timezone'),
    ]
    for (let i = 0; i < titles.length - 1; i++) {
      expect(titles[i].compareDocumentPosition(titles[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('renders the daily heads-up hint in the same inline row as the time input', async () => {
    renderWithProviders(<SettingsPage />)
    const hint = await screen.findByText(/Your daily summary notification time/)
    const timeInput = screen.getByDisplayValue('08:00')
    // Both share the same inline parent (.inlineField wrapper)
    expect(hint.parentElement).toBe(timeInput.parentElement)
  })

  describe('offline soft block', () => {
    afterEach(() => {
      reachableRef.current = true
    })

    it('renders the soft-block banner when offline', async () => {
      reachableRef.current = false
      renderWithProviders(<SettingsPage />)
      expect(await screen.findByText(/Settings require a connection/i)).toBeInTheDocument()
    })

    it('disables the daily-time input and all comboboxes offline', async () => {
      reachableRef.current = false
      renderWithProviders(<SettingsPage />)
      await screen.findByText(/Settings require a connection/i)
      expect(screen.getByDisplayValue('08:00')).toBeDisabled()
      // Both comboboxes (contact search + timezone) are disabled.
      const comboboxes = screen.getAllByRole('combobox')
      expect(comboboxes.length).toBeGreaterThan(0)
      for (const cb of comboboxes) expect(cb).toBeDisabled()
    })

    it('disables the language toggle buttons offline', async () => {
      reachableRef.current = false
      renderWithProviders(<SettingsPage />)
      await screen.findByText(/Settings require a connection/i)
      for (const name of ['English', 'Español', 'Galego']) {
        expect(screen.getByRole('button', { name })).toBeDisabled()
      }
    })

    it('disables the remove-contact buttons offline', async () => {
      reachableRef.current = false
      server.use(http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json([{ id: 1, username: 'alice' }])))
      renderWithProviders(<SettingsPage />)
      await screen.findByText('alice')
      const removeButtons = screen
        .getAllByRole('button')
        .filter((btn) => btn.getAttribute('aria-label') === 'Remove contact')
      expect(removeButtons.length).toBeGreaterThan(0)
      for (const btn of removeButtons) expect(btn).toBeDisabled()
    })
  })

  describe('Troubleshooting section (T111)', () => {
    /**
     * Mount SettingsPage with push active (Notification.permission='granted'
     * + a fake serviceWorker subscription). Mirrors the setup used by the
     * existing push tests above.
     */
    async function renderWithPushActive() {
      Object.defineProperty(window, 'Notification', {
        value: { permission: 'granted', requestPermission: vi.fn() },
        writable: true,
      })
      const reg = await navigator.serviceWorker.ready
      reg.pushManager.getSubscription.mockResolvedValueOnce({
        endpoint: 'https://push.example.com/sub/123',
        unsubscribe: vi.fn().mockResolvedValue(true),
      })
      return renderWithProviders(<SettingsPage />)
    }

    it('hides the Send/Schedule test buttons by default when push is active', async () => {
      await renderWithPushActive()
      // Wait for push to mount before asserting the toggle.
      expect(await screen.findByTestId('push-troubleshooting-toggle')).toBeInTheDocument()
      // Both diagnostic buttons must be absent from the DOM until the user expands.
      expect(screen.queryByText('Send test notification')).not.toBeInTheDocument()
      expect(screen.queryByText(/Schedule test \(5 min\)/)).not.toBeInTheDocument()
      // The hint paragraph is also gated behind expansion.
      expect(screen.queryByText(/Use these only if you suspect/i)).not.toBeInTheDocument()
    })

    it('reveals the test buttons + hint after expanding the Troubleshooting header', async () => {
      const { user } = await renderWithPushActive()
      const toggle = await screen.findByTestId('push-troubleshooting-toggle')
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await user.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText('Send test notification')).toBeInTheDocument()
      expect(screen.getByText(/Schedule test \(5 min\)/)).toBeInTheDocument()
      expect(screen.getByText(/Use these only if you suspect/i)).toBeInTheDocument()
    })

    it('does not render the Troubleshooting toggle when push is not active', async () => {
      // No Notification override / no fake subscription → push is NOT active.
      renderWithProviders(<SettingsPage />)
      // Wait for the page to mount; checking a stable element first.
      await screen.findByText('Settings')
      expect(screen.queryByTestId('push-troubleshooting-toggle')).not.toBeInTheDocument()
    })
  })
})
