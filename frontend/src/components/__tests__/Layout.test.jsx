import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import Layout from '../Layout'

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
    expect(screen.getByText('Nudge')).toBeInTheDocument()
  })

  it('shows push badge on Settings when notifications not granted', () => {
    // Default setup has Notification.permission = 'default', so badge should show
    Object.defineProperty(window, 'Notification', {
      value: { permission: 'default', requestPermission: vi.fn() },
      writable: true,
    })
    const { container } = renderWithProviders(<Layout />)
    const badge = container.querySelector('.badge')
    expect(badge).toBeInTheDocument()
  })

  it('hides push badge when notifications granted', () => {
    Object.defineProperty(window, 'Notification', {
      value: { permission: 'granted', requestPermission: vi.fn() },
      writable: true,
    })
    const { container } = renderWithProviders(<Layout />)
    const badge = container.querySelector('.badge')
    expect(badge).not.toBeInTheDocument()
  })
})
