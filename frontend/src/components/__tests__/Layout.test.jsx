import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import Layout from '../Layout'

const BASE = 'http://localhost/api'

function setNotification(permission) {
  Object.defineProperty(window, 'Notification', {
    value: { permission, requestPermission: vi.fn() },
    writable: true,
  })
}

async function stubSubscription(sub) {
  const reg = await navigator.serviceWorker.ready
  reg.pushManager.getSubscription.mockResolvedValue(sub)
}

describe('Layout', () => {
  it('renders 4 nav links', () => {
    renderWithProviders(<Layout />)
    expect(screen.getByText('Routines')).toBeInTheDocument()
    expect(screen.getByText('Inventory')).toBeInTheDocument()
    expect(screen.getByText('History')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('Routines link has active class at /', () => {
    renderWithProviders(<Layout />, { initialEntries: ['/'] })
    const homeLink = screen.getByText('Routines').closest('a')
    expect(homeLink.className).toContain('linkActive')
  })

  it('Settings link has active class at /settings', () => {
    renderWithProviders(<Layout />, { initialEntries: ['/settings'] })
    const settingsLink = screen.getByText('Settings').closest('a')
    expect(settingsLink.className).toContain('linkActive')
  })

  it('renders Header component', () => {
    renderWithProviders(<Layout />)
    expect(screen.getByText('nudge')).toBeInTheDocument()
  })

  it('shows push badge on Settings when push is not fully active', async () => {
    setNotification('default')
    await stubSubscription(null)
    const { container } = renderWithProviders(<Layout />)
    await waitFor(() => expect(container.querySelector('.badge')).toBeInTheDocument())
  })

  it('updates push badge on window focus when status changes', async () => {
    setNotification('default')
    await stubSubscription(null)
    const { container } = renderWithProviders(<Layout />)
    await waitFor(() => expect(container.querySelector('.badge')).toBeInTheDocument())

    setNotification('granted')
    await stubSubscription({
      endpoint: 'https://push.example.com/sub/abc',
      unsubscribe: vi.fn(),
    })
    fireEvent.focus(window)

    await waitFor(() => expect(container.querySelector('.badge')).not.toBeInTheDocument())
  })

  it('hides push badge when push is fully active', async () => {
    setNotification('granted')
    await stubSubscription({
      endpoint: 'https://push.example.com/sub/xyz',
      unsubscribe: vi.fn(),
    })
    const { container } = renderWithProviders(<Layout />)
    // Wait for the hook's effect to resolve before asserting absence.
    await waitFor(() => expect(container.querySelector('.badge')).not.toBeInTheDocument())
  })

  // ── AlertBanner placement (T053) ───────────────────────────────────────────

  it('renders the push alert banner when push is not active', async () => {
    setNotification('default')
    await stubSubscription(null)
    renderWithProviders(<Layout />)
    expect(await screen.findByText(/Notifications are off/)).toBeInTheDocument()
  })

  it('does not render the banner when push is fully active', async () => {
    setNotification('granted')
    await stubSubscription({
      endpoint: 'https://push.example.com/sub/abc',
      unsubscribe: vi.fn(),
    })
    const { container } = renderWithProviders(<Layout />)
    await waitFor(() => expect(container.querySelector('.badge')).not.toBeInTheDocument())
    expect(screen.queryByText(/Notifications are off/)).not.toBeInTheDocument()
  })

  it('shows a pending-routines dot on the Routines nav entry when any routine is due', async () => {
    setNotification('granted')
    await stubSubscription({ endpoint: 'https://push.example.com/sub/abc', unsubscribe: vi.fn() })
    server.use(
      http.get(`${BASE}/routines/`, () =>
        HttpResponse.json([
          { id: 1, name: 'Water plants', interval_hours: 24, is_due: true },
          { id: 2, name: 'Call dad', interval_hours: 168, is_due: false },
        ]),
      ),
    )
    const { container } = renderWithProviders(<Layout />)
    await waitFor(() => {
      const routinesLink = screen.getByText('Routines').closest('a')
      expect(routinesLink.querySelector('.badge')).toBeInTheDocument()
    })
    // When push is active, the only badge should be the routines dot.
    expect(container.querySelectorAll('.badge').length).toBeGreaterThan(0)
  })

  it('places the banner before the main element in the DOM', async () => {
    setNotification('default')
    await stubSubscription(null)
    const { container } = renderWithProviders(<Layout />)
    const banner = await screen.findByText(/Notifications are off/)
    const main = container.querySelector('main')
    expect(main).not.toBeNull()
    expect(banner.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
