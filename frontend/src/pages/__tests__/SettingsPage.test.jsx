import { act, screen, waitFor, within } from '@testing-library/react'
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

  describe('hash deep-link to push section', () => {
    let scrollMock
    let originalScrollIntoView
    beforeEach(() => {
      // jsdom doesn't implement scrollIntoView; install a mock so the
      // deep-link effect runs without throwing and we can assert calls.
      originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView
      scrollMock = vi.fn()
      window.HTMLElement.prototype.scrollIntoView = scrollMock
    })
    afterEach(() => {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView
      vi.useRealTimers()
    })

    it('scrolls the push section and applies a one-shot flash when the hash is #push', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const { container } = renderWithProviders(<SettingsPage />, {
        initialEntries: ['/settings#push'],
      })
      // Wait for the section to mount before the effect runs.
      await screen.findByText('Push notifications')

      // The effect calls scrollIntoView on the matching section element.
      expect(scrollMock).toHaveBeenCalled()

      // The flash class is present mid-animation. Module CSS hashes the
      // class name; match on suffix.
      const pushSection = container.querySelector('#push')
      expect(pushSection).not.toBeNull()
      expect(pushSection.className).toMatch(/flash/)

      // After 1.2s the flash class is removed.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1300)
      })
      expect(pushSection.className).not.toMatch(/flash/)
    })

    it('does nothing when the hash points to a non-existent section', async () => {
      renderWithProviders(<SettingsPage />, {
        initialEntries: ['/settings#does-not-exist'],
      })
      await screen.findByText('Settings')
      expect(scrollMock).not.toHaveBeenCalled()
    })
  })

  it('shows the email in the profile section when first/last name are absent', async () => {
    // Default test user has no first/last name set → display falls back
    // to the email. The email appears both as the heading (fullName
    // fallback) and as the secondary helpText below.
    renderWithProviders(<SettingsPage />)
    const heading = await screen.findByRole('heading', { name: 'testuser@example.com' })
    expect(heading).toBeInTheDocument()
  })

  it('renders the full name (no username suffix) when first/last are set', async () => {
    renderWithProviders(<SettingsPage />, {
      auth: {
        user: {
          id: 1,
          username: 'jdoe',
          email: 'jdoe@example.com',
          first_name: 'Jane',
          last_name: 'Doe',
          is_staff: false,
          timezone: 'Europe/Madrid',
          language: 'en',
          daily_notification_time: '08:00:00',
        },
      },
    })
    const heading = await screen.findByRole('heading', { name: 'Jane Doe' })
    expect(heading.textContent).toBe('Jane Doe')
    // Email is shown below the heading as secondary metadata.
    expect(screen.getByText('jdoe@example.com')).toBeInTheDocument()
    // Username is internal-only post-T197 — never rendered.
    expect(screen.queryByText('jdoe')).not.toBeInTheDocument()
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

  it('autosaves the daily-notification-time on change with debounce', async () => {
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
    await waitFor(() => expect(patchedBody).not.toBeNull(), { timeout: 2000 })
    expect(patchedBody).toEqual({ daily_notification_time: '09:15' })
  })

  it('surfaces an error toast when autosave fails', async () => {
    server.use(http.patch(`${BASE}/auth/me/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderWithProviders(<SettingsPage />)
    const input = await screen.findByDisplayValue('08:00')
    await user.clear(input)
    await user.type(input, '09:15')
    await waitFor(() => expect(screen.getByText('Error — try again')).toBeInTheDocument(), { timeout: 2000 })
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
          { id: 10, first_name: '', last_name: '', email: 'alice@example.com' },
          { id: 11, first_name: 'Charlie', last_name: 'Brown', email: 'charlie@example.com' },
        ]),
      ),
    )
    renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument()
  })

  it('renders contact full name plus email helpText when first/last are set', async () => {
    server.use(
      http.get(`${BASE}/auth/contacts/`, () =>
        HttpResponse.json([{ id: 10, first_name: 'Alice', last_name: 'Liddell', email: 'alice@example.com' }]),
      ),
    )
    renderWithProviders(<SettingsPage />)
    const list = await screen.findByTestId('contacts-list')
    expect(within(list).getByText('Alice Liddell')).toBeInTheDocument()
    // The email is shown in helpText below the name.
    expect(within(list).getByText('(alice@example.com)')).toBeInTheDocument()
  })

  it('adds a contact via the email-exact form', async () => {
    server.use(
      http.post(`${BASE}/auth/contacts/`, () =>
        HttpResponse.json({ id: 50, first_name: '', last_name: '', email: 'bob@example.com' }, { status: 201 }),
      ),
    )
    const { user } = renderWithProviders(<SettingsPage />)
    await screen.findByText('Contacts')
    const input = screen.getByTestId('add-contact-email')
    await user.type(input, 'bob@example.com')
    await user.click(screen.getByTestId('add-contact-submit'))
    // After success the input is cleared and the new contact joins the list.
    await waitFor(() => expect(input.value).toBe(''))
    await waitFor(() => expect(screen.getByText('bob@example.com')).toBeInTheDocument())
  })

  it('rejects invalid email format client-side without firing a request', async () => {
    let posted = false
    server.use(
      http.post(`${BASE}/auth/contacts/`, () => {
        posted = true
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    const { user } = renderWithProviders(<SettingsPage />)
    await screen.findByText('Contacts')
    const input = screen.getByTestId('add-contact-email')
    await user.type(input, 'not-an-email')
    await user.click(screen.getByTestId('add-contact-submit'))
    await waitFor(() => expect(screen.getByText('Please enter a valid email address.')).toBeInTheDocument())
    expect(posted).toBe(false)
  })

  it('shows the not-found error when the backend returns 404', async () => {
    server.use(
      http.post(`${BASE}/auth/contacts/`, () => HttpResponse.json({ detail: 'User not found.' }, { status: 404 })),
    )
    const { user } = renderWithProviders(<SettingsPage />)
    await screen.findByText('Contacts')
    await user.type(screen.getByTestId('add-contact-email'), 'ghost@example.com')
    await user.click(screen.getByTestId('add-contact-submit'))
    await waitFor(() => expect(screen.getByText('No user with that email.')).toBeInTheDocument())
  })

  it('marks the email input as invalid after a failed add and clears the flag once the user edits', async () => {
    server.use(
      http.post(`${BASE}/auth/contacts/`, () => HttpResponse.json({ detail: 'User not found.' }, { status: 404 })),
    )
    const { user } = renderWithProviders(<SettingsPage />)
    await screen.findByText('Contacts')
    const input = screen.getByTestId('add-contact-email')

    await user.type(input, 'ghost@example.com')
    await user.click(screen.getByTestId('add-contact-submit'))

    // After the failure the input picks up the `inputInvalid` CSS-modules
    // class — we assert via the className attribute since jsdom doesn't
    // compute resolved colours.
    await waitFor(() => expect(input.className).toMatch(/inputInvalid/))

    // Typing into the field clears the invalid flag on the next keystroke.
    await user.type(input, 'x')
    expect(input.className).not.toMatch(/inputInvalid/)
  })

  it('shows the cannot-add-yourself error when the backend returns 400 with that detail', async () => {
    server.use(
      http.post(`${BASE}/auth/contacts/`, () =>
        HttpResponse.json({ detail: 'You cannot add yourself as a contact.' }, { status: 400 }),
      ),
    )
    const { user } = renderWithProviders(<SettingsPage />)
    await screen.findByText('Contacts')
    await user.type(screen.getByTestId('add-contact-email'), 'me@nudge.test')
    await user.click(screen.getByTestId('add-contact-submit'))
    await waitFor(() =>
      expect(screen.getByText("You can't add yourself as a contact.")).toBeInTheDocument(),
    )
  })

  it('shows the already-a-contact error when the backend returns 400 with that detail', async () => {
    server.use(
      http.post(`${BASE}/auth/contacts/`, () => HttpResponse.json({ detail: 'Already a contact.' }, { status: 400 })),
    )
    const { user } = renderWithProviders(<SettingsPage />)
    await screen.findByText('Contacts')
    await user.type(screen.getByTestId('add-contact-email'), 'bob@example.com')
    await user.click(screen.getByTestId('add-contact-submit'))
    await waitFor(() => expect(screen.getByText('Already a contact.')).toBeInTheDocument())
  })

  it('renders contacts with an avatar initial', async () => {
    server.use(
      http.get(`${BASE}/auth/contacts/`, () =>
        HttpResponse.json([{ id: 10, first_name: '', last_name: '', email: 'alice@example.com' }]),
      ),
    )
    renderWithProviders(<SettingsPage />)
    const nameNode = await screen.findByText('alice@example.com')
    const row = nameNode.closest('li')
    expect(row).not.toBeNull()
    // The avatar uses the first letter of the email when no first_name.
    expect(row.textContent.startsWith('A')).toBe(true)
  })

  it('removes contact with confirmation', async () => {
    server.use(
      http.get(`${BASE}/auth/contacts/`, () =>
        HttpResponse.json([{ id: 10, first_name: '', last_name: '', email: 'alice@example.com' }]),
      ),
    )
    const { user } = renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('alice@example.com')).toBeInTheDocument()
    await user.click(screen.getByTitle('Remove contact'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove contact' }))
    await waitFor(() => expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument())
  })

  it('shows "Action not available offline" when add contact hits a network error', async () => {
    server.use(http.post(`${BASE}/auth/contacts/`, () => HttpResponse.error()))
    const { user } = renderWithProviders(<SettingsPage />)
    await screen.findByText('Contacts')
    await user.type(screen.getByTestId('add-contact-email'), 'bob@example.com')
    await user.click(screen.getByTestId('add-contact-submit'))
    await waitFor(() => expect(screen.getByText(/Action not available offline/i)).toBeInTheDocument())
  })

  it('shows "Action not available offline" when remove contact hits a network error', async () => {
    server.use(
      http.get(`${BASE}/auth/contacts/`, () =>
        HttpResponse.json([{ id: 10, first_name: '', last_name: '', email: 'alice@example.com' }]),
      ),
      http.delete(`${BASE}/auth/contacts/:id/`, () => HttpResponse.error()),
    )
    const { user } = renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('alice@example.com')).toBeInTheDocument()
    await user.click(screen.getByTitle('Remove contact'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove contact' }))
    await waitFor(() => expect(screen.getByText(/Action not available offline/i)).toBeInTheDocument())
  })

  it('shows error when remove contact returns a server error', async () => {
    server.use(
      http.get(`${BASE}/auth/contacts/`, () =>
        HttpResponse.json([{ id: 10, first_name: '', last_name: '', email: 'alice@example.com' }]),
      ),
      http.delete(`${BASE}/auth/contacts/:id/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { user } = renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('alice@example.com')).toBeInTheDocument()
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
    await user.type(screen.getByTestId('add-contact-email'), 'bob@example.com')
    await user.click(screen.getByTestId('add-contact-submit'))
    await waitFor(() => expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument())
  })

  it('does not remove contact when the confirm dialog is dismissed', async () => {
    server.use(
      http.get(`${BASE}/auth/contacts/`, () =>
        HttpResponse.json([{ id: 10, first_name: '', last_name: '', email: 'alice@example.com' }]),
      ),
    )
    const deleteSpy = vi.fn()
    server.use(
      http.delete(`${BASE}/auth/contacts/:id/`, () => {
        deleteSpy()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user } = renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('alice@example.com')).toBeInTheDocument()
    await user.click(screen.getByTitle('Remove contact'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteSpy).not.toHaveBeenCalled()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
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

  // Contact search endpoint was removed in T194/T197 — the
  // `handles contact search API failure gracefully` and `does not call
  // API for search with short query` tests no longer apply.

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

  // ── Profile (T042) ─────────────────────────────────────────────────────────

  it('renders the email as the secondary metadata under the display name', async () => {
    renderWithProviders(<SettingsPage />, {
      auth: {
        user: {
          id: 1,
          username: 'testuser',
          email: 'testuser@example.com',
          first_name: 'Test',
          last_name: 'User',
          timezone: 'Europe/Madrid',
          language: 'en',
          daily_notification_time: '08:00:00',
        },
      },
    })
    // The heading is the display name; the email is rendered separately
    // below as the secondary line.
    const heading = await screen.findByRole('heading', { name: 'Test User' })
    expect(heading).toBeInTheDocument()
    expect(screen.getByText('testuser@example.com')).toBeInTheDocument()
  })

  it('omits the email line when the user has no email on file', async () => {
    renderWithProviders(<SettingsPage />, {
      auth: {
        user: {
          id: 1,
          username: 'testuser',
          email: '',
          first_name: 'Solo',
          last_name: 'User',
          timezone: 'Europe/Madrid',
          language: 'en',
          daily_notification_time: '08:00:00',
        },
      },
    })
    // The heading still renders the display name.
    await screen.findByRole('heading', { name: 'Solo User' })
    // No email rendered — the only `@` on the page shouldn't appear.
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
      server.use(
        http.get(`${BASE}/auth/contacts/`, () =>
          HttpResponse.json([{ id: 1, first_name: '', last_name: '', email: 'alice@example.com' }]),
        ),
      )
      renderWithProviders(<SettingsPage />)
      await screen.findByText('alice@example.com')
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

  describe('Quiet hours (T187)', () => {
    const defaultUser = {
      id: 1,
      username: 'testuser',
      is_staff: false,
      timezone: 'Europe/Madrid',
      language: 'en',
      daily_notification_time: '08:00:00',
    }

    const userWithQuietHours = {
      ...defaultUser,
      quiet_hours_enabled: true,
      quiet_hours_start: '22:00:00',
      quiet_hours_end: '07:00:00',
    }

    it('renders the Quiet hours block before the Daily heads-up section', async () => {
      const { container } = renderWithProviders(<SettingsPage />)
      const quietHours = await screen.findByText('Quiet hours')
      const dailyTime = screen.getByText('Daily heads-up time')
      // Both belong to sectionTitle paragraphs. Verify document order.
      const relation = quietHours.compareDocumentPosition(dailyTime)
      expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      // Sanity check: time inputs render where expected within the block.
      expect(container.querySelector('[data-testid="quiet-hours-start"]')).not.toBeNull()
      expect(container.querySelector('[data-testid="quiet-hours-end"]')).not.toBeNull()
    })

    it('disables the time inputs by default when the user has quiet hours off', async () => {
      renderWithProviders(<SettingsPage />, { auth: { user: defaultUser } })
      const start = await screen.findByTestId('quiet-hours-start')
      const end = screen.getByTestId('quiet-hours-end')
      expect(start).toBeDisabled()
      expect(end).toBeDisabled()
    })

    it('enables the time inputs and PATCHes when the toggle is turned on', async () => {
      let patchedBody = null
      server.use(
        http.patch(`${BASE}/auth/me/`, async ({ request }) => {
          patchedBody = await request.json()
          return HttpResponse.json({})
        }),
      )
      const { user } = renderWithProviders(<SettingsPage />, { auth: { user: defaultUser } })
      const toggle = await screen.findByLabelText('Enable quiet hours')
      expect(toggle).not.toBeChecked()
      await user.click(toggle)
      await waitFor(() => expect(patchedBody).not.toBeNull(), { timeout: 2000 })
      expect(patchedBody).toEqual({ quiet_hours_enabled: true })
      expect(screen.getByTestId('quiet-hours-start')).not.toBeDisabled()
      expect(screen.getByTestId('quiet-hours-end')).not.toBeDisabled()
    })

    it('auto-disables the toggle when start equals end', async () => {
      const patches = []
      server.use(
        http.patch(`${BASE}/auth/me/`, async ({ request }) => {
          patches.push(await request.json())
          return HttpResponse.json({})
        }),
      )
      const { user } = renderWithProviders(<SettingsPage />, { auth: { user: userWithQuietHours } })
      const end = await screen.findByTestId('quiet-hours-end')
      // Sanity: enabled at start, end input editable.
      const toggle = screen.getByLabelText('Enable quiet hours')
      expect(toggle).toBeChecked()
      // Set end == start.
      await user.clear(end)
      await user.type(end, '22:00')
      await waitFor(() => expect(toggle).not.toBeChecked(), { timeout: 2000 })
      expect(end).toBeDisabled()
      // The PATCH must include the auto-disable so the backend sees enabled=false.
      const lastPatch = patches[patches.length - 1]
      expect(lastPatch).toMatchObject({ quiet_hours_enabled: false, quiet_hours_end: '22:00' })
    })

    it('blocks the daily-time autosave when daily falls inside the active quiet hours range', async () => {
      let patchedBody = null
      server.use(
        http.patch(`${BASE}/auth/me/`, async ({ request }) => {
          patchedBody = await request.json()
          return HttpResponse.json({})
        }),
      )
      const { user } = renderWithProviders(<SettingsPage />, { auth: { user: userWithQuietHours } })
      const daily = await screen.findByDisplayValue('08:00')
      await user.clear(daily)
      await user.type(daily, '06:00')
      // Wait past the 500ms debounce.
      await new Promise((resolve) => setTimeout(resolve, 800))
      expect(patchedBody).toBeNull()
      expect(screen.getByTestId('quiet-hours-overlap-error')).toBeInTheDocument()
    })

    it('allows the daily-time autosave when the toggle is off, even if the range would overlap', async () => {
      let patchedBody = null
      server.use(
        http.patch(`${BASE}/auth/me/`, async ({ request }) => {
          patchedBody = await request.json()
          return HttpResponse.json({})
        }),
      )
      // enabled=false → validator should NOT fire; daily can move freely.
      const userOff = { ...userWithQuietHours, quiet_hours_enabled: false }
      const { user } = renderWithProviders(<SettingsPage />, { auth: { user: userOff } })
      const daily = await screen.findByDisplayValue('08:00')
      await user.clear(daily)
      await user.type(daily, '06:00')
      await waitFor(() => expect(patchedBody).not.toBeNull(), { timeout: 2000 })
      expect(patchedBody).toEqual({ daily_notification_time: '06:00' })
      expect(screen.queryByTestId('quiet-hours-overlap-error')).not.toBeInTheDocument()
    })
  })
})
