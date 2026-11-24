import { act, fireEvent, screen, waitFor } from '@testing-library/react'
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

// Each test starts from no permission: a `granted` left by a previous one
// would make the notice read the subscription after that test has ended.
beforeEach(() => setNotification('default'))

describe('Layout', () => {
  describe('with the on-screen keyboard', () => {
    let viewport
    let field

    const resize = (height) =>
      act(() => {
        viewport.height = height
        viewport.dispatchEvent(new Event('resize'))
      })

    beforeEach(() => {
      viewport = Object.assign(new EventTarget(), { width: 412, height: 900, scale: 1 })
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
      field = document.createElement('input')
      document.body.appendChild(field)
    })

    afterEach(() => {
      field.remove()
      delete window.visualViewport
    })

    it('marks the document while the keyboard is up', () => {
      renderWithProviders(<Layout />)
      act(() => field.focus())

      resize(500)

      expect(document.documentElement.dataset.keyboard).toBe('open')
    })

    it('clears the mark when the keyboard closes', () => {
      renderWithProviders(<Layout />)
      act(() => field.focus())
      resize(500)

      resize(900)

      expect(document.documentElement.dataset.keyboard).toBeUndefined()
    })
  })

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

  it('Settings carries no dot with actions pending: the notice says it', async () => {
    setNotification('default')
    await stubSubscription(null)
    renderWithProviders(<Layout />)
    await screen.findByText(/pending action/i)
    expect(screen.getByRole('link', { name: 'Settings' }).querySelector('.badge')).toBeNull()
  })

  // ── AlertBanner placement (T053) ───────────────────────────────────────────

  it('renders the pending-actions notice when push is not active', async () => {
    setNotification('default')
    await stubSubscription(null)
    renderWithProviders(<Layout />)
    expect(await screen.findByText(/pending action/i)).toBeInTheDocument()
  })

  it('the pending-actions notice takes the user to Settings', async () => {
    setNotification('default')
    await stubSubscription(null)
    const { user } = renderWithProviders(<Layout />, { initialEntries: ['/'] })

    await user.click(await screen.findByRole('button', { name: /pending action/i }))

    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
  })

  it('does not render the notice when push is fully active', async () => {
    setNotification('granted')
    await stubSubscription({
      endpoint: 'https://push.example.com/sub/abc',
      unsubscribe: vi.fn(),
    })
    const reg = await navigator.serviceWorker.ready
    renderWithProviders(<Layout />)
    await waitFor(() => expect(reg.pushManager.getSubscription).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByText(/pending action/i)).not.toBeInTheDocument()
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
    expect(container.querySelectorAll('.badge')).toHaveLength(1)
  })

  // The icon a nav entry draws from the sprite (`<use href="#i-NAME">`).
  const navIcon = (name) => screen.getByRole('link', { name }).querySelector('use').getAttribute('href')
  // Layout re-renders when its routines query lands; assert after that.
  const routinesLoaded = (queryClient) =>
    waitFor(() => expect(queryClient.getQueryState(['routines'])?.status).toBe('success'))

  it.each([
    ['with', true],
    ['without', false],
  ])('Routines uses the list-checks icon %s pending routines', async (_, isDue) => {
    server.use(
      http.get(`${BASE}/routines/`, () =>
        HttpResponse.json([{ id: 1, name: 'Water plants', interval_hours: 24, is_due: isDue }]),
      ),
    )
    const { queryClient } = renderWithProviders(<Layout />)
    await routinesLoaded(queryClient)

    expect(Boolean(screen.getByRole('link', { name: 'Routines' }).querySelector('.badge'))).toBe(isDue)
    expect(navIcon('Routines')).toBe('#i-list-checks')
  })

  it('History uses the clock-with-arrow history icon', async () => {
    const { queryClient } = renderWithProviders(<Layout />)
    await routinesLoaded(queryClient)

    expect(navIcon('History')).toBe('#i-history')
  })

  it('the active tab keeps its name for assistive tech, and moves with navigation', async () => {
    const { user } = renderWithProviders(<Layout />, { initialEntries: ['/'] })
    const routines = screen.getByRole('link', { name: 'Routines' })
    expect(routines).toHaveAttribute('aria-current', 'page')
    expect(routines).toHaveTextContent('Routines')

    await user.click(screen.getByRole('link', { name: 'Inventory' }))

    expect(screen.getByRole('link', { name: 'Inventory' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Routines' })).not.toHaveAttribute('aria-current')
  })

  it('the sliding block follows the current tab', async () => {
    const { user } = renderWithProviders(<Layout />, { initialEntries: ['/'] })
    const pill = screen.getByTestId('nav-indicator')
    expect(pill.style.getPropertyValue('--tab')).toBe('0')

    await user.click(screen.getByRole('link', { name: 'History' }))

    expect(pill.style.getPropertyValue('--tab')).toBe('2')
  })

  it.each([
    ['/routines/7', 'Routines', '0'],
    ['/routines/7/edit', 'Routines', '0'],
    ['/inventory/3', 'Inventory', '1'],
  ])('%s keeps %s as the current tab', async (path, name, tab) => {
    const { queryClient } = renderWithProviders(<Layout />, { initialEntries: [path] })
    await routinesLoaded(queryClient)
    expect(screen.getByRole('link', { name })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('nav-indicator').style.getPropertyValue('--tab')).toBe(tab)
  })

  it('every tab carries its own label as text, not only the active one (T151)', async () => {
    const { queryClient } = renderWithProviders(<Layout />, { initialEntries: ['/'] })
    await routinesLoaded(queryClient)
    for (const label of ['Routines', 'Inventory', 'History', 'Settings']) {
      expect(screen.getByRole('link', { name: label })).toHaveTextContent(label)
    }
  })

  it('places the banner before the main element in the DOM', async () => {
    setNotification('default')
    await stubSubscription(null)
    const { container } = renderWithProviders(<Layout />)
    const banner = await screen.findByText(/pending action/i)
    const main = container.querySelector('main')
    expect(main).not.toBeNull()
    expect(banner.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

describe('Layout scroll on navigation', () => {
  const setScrollY = (y) => Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true })
  let scrollTo

  beforeEach(() => {
    setScrollY(0)
    scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  })

  afterEach(() => {
    scrollTo.mockRestore()
    setScrollY(0)
  })

  it('opens a new page at its top', async () => {
    const { user } = renderWithProviders(<Layout />, { initialEntries: ['/'] })
    setScrollY(500)
    await user.click(screen.getByRole('link', { name: 'History' }))
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('leaves the inventory to restore its own offset', async () => {
    const { user } = renderWithProviders(<Layout />, { initialEntries: ['/'] })
    setScrollY(500)
    await user.click(screen.getByRole('link', { name: 'Inventory' }))
    expect(screen.getByRole('link', { name: 'Inventory' })).toHaveAttribute('aria-current', 'page')
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('does not scroll a page that is already at its top', () => {
    renderWithProviders(<Layout />, { initialEntries: ['/history'] })
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
