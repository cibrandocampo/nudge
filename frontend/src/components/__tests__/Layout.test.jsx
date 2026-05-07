import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'

vi.mock('../../hooks/useInstallPrompt', () => ({
  useInstallPrompt: vi.fn(() => ({
    canInstall: false,
    hasNativePrompt: false,
    platform: 'other',
    triggerNativePrompt: vi.fn(),
  })),
}))

// Toggleable reachability mock for the offline-locked nav tests at the
// end of the file. Defaults to ``true`` so every existing case keeps
// behaving exactly as before. The locked-nav tests flip it to ``false``
// in their setup and reset to ``true`` in afterEach.
const reachableRef = { current: true }
vi.mock('../../hooks/useServerReachable', () => ({
  useServerReachable: () => reachableRef.current,
}))

import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import { useInstallPrompt } from '../../hooks/useInstallPrompt'
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

  // ── Install banner priority over notif AlertBanner (T149) ──────────────────

  it('suppresses the push alert banner when the install banner is visible', async () => {
    useInstallPrompt.mockReturnValueOnce({
      canInstall: true,
      hasNativePrompt: false,
      platform: 'ios',
      triggerNativePrompt: vi.fn(),
    })
    setNotification('default')
    await stubSubscription(null)
    renderWithProviders(<Layout />)
    expect(screen.queryByText(/Notifications are off/)).not.toBeInTheDocument()
  })

  it('keeps the bottom-nav push badge even when the install banner suppresses the alert', async () => {
    useInstallPrompt.mockReturnValueOnce({
      canInstall: true,
      hasNativePrompt: false,
      platform: 'ios',
      triggerNativePrompt: vi.fn(),
    })
    setNotification('default')
    await stubSubscription(null)
    const { container } = renderWithProviders(<Layout />)
    await waitFor(() => expect(container.querySelector('.badge')).toBeInTheDocument())
  })
})

// ── Bottom-nav: lock /history and /settings while offline (T182) ────────────

describe('Layout — bottom nav offline lock', () => {
  afterEach(() => {
    reachableRef.current = true
  })

  // Use exact aria-labels so the locator doesn't collide with other
  // elements that mention the route name (e.g. the push-alert banner
  // links to "/settings" with a longer label). The bottom-nav items
  // expose the bare ``nav.*`` translation as their aria-label.
  it('renders /history and /settings as enabled NavLinks while reachable', () => {
    reachableRef.current = true
    renderWithProviders(<Layout />)
    const history = screen.getByRole('link', { name: 'History' })
    const settings = screen.getByRole('link', { name: 'Settings' })
    expect(history).not.toHaveAttribute('aria-disabled')
    expect(settings).not.toHaveAttribute('aria-disabled')
  })

  it('renders /history and /settings as aria-disabled buttons when offline', () => {
    reachableRef.current = false
    renderWithProviders(<Layout />)
    const history = screen.getByRole('button', { name: 'History' })
    const settings = screen.getByRole('button', { name: 'Settings' })
    expect(history).toHaveAttribute('aria-disabled', 'true')
    expect(settings).toHaveAttribute('aria-disabled', 'true')
    // Same role lookup must NOT find a link with that label.
    expect(screen.queryByRole('link', { name: 'History' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('keeps Routines and Inventory navigable when offline (lock is scoped)', () => {
    reachableRef.current = false
    renderWithProviders(<Layout />)
    expect(screen.getByRole('link', { name: 'Routines' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Inventory' })).toBeInTheDocument()
  })

  it('clicking a locked nav item does not navigate and surfaces the offline toast', async () => {
    reachableRef.current = false
    renderWithProviders(<Layout />)
    const history = screen.getByRole('button', { name: 'History' })
    fireEvent.click(history)
    await waitFor(() => expect(screen.getByText(/not available offline/i)).toBeInTheDocument())
  })
})
