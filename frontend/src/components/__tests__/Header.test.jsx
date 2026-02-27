import { screen, waitFor, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import Header from '../Header'

const BASE = 'http://localhost/api'

describe('Header', () => {
  it('shows username', () => {
    renderWithProviders(<Header />)
    expect(screen.getByText('testuser')).toBeInTheDocument()
  })

  it('shows Nudge logo', () => {
    renderWithProviders(<Header />)
    expect(screen.getByText('Nudge')).toBeInTheDocument()
  })

  it('shows Admin button for staff users', () => {
    renderWithProviders(<Header />, {
      auth: { user: { id: 1, username: 'admin', is_staff: true } },
    })
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('Admin button calls goToAdmin which submits a form', async () => {
    // We intercept form.submit to prevent jsdom navigation error
    const origAppend = document.body.appendChild.bind(document.body)
    const formRef = { current: null }
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((el) => {
      if (el.tagName === 'FORM') {
        el.submit = vi.fn()
        formRef.current = el
      }
      return origAppend(el)
    })

    localStorage.setItem('access_token', 'admin-token')
    const { user } = renderWithProviders(<Header />, {
      auth: { user: { id: 1, username: 'admin', is_staff: true } },
    })
    await user.click(screen.getByText('Admin'))

    expect(formRef.current).not.toBeNull()
    expect(formRef.current.action).toContain('/api/auth/admin-access/')
    expect(formRef.current.method.toUpperCase()).toBe('POST')

    appendSpy.mockRestore()
  })

  it('hides Admin button for non-staff users', () => {
    renderWithProviders(<Header />)
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  })

  it('toggles dropdown on username click', async () => {
    const { user } = renderWithProviders(<Header />)
    expect(screen.queryByText('Sign out')).not.toBeInTheDocument()

    await user.click(screen.getByText('testuser'))
    expect(screen.getByText('Sign out')).toBeInTheDocument()

    await user.click(screen.getByText('testuser'))
    expect(screen.queryByText('Sign out')).not.toBeInTheDocument()
  })

  it('closes dropdown on outside click', async () => {
    const { user } = renderWithProviders(<Header />)
    await user.click(screen.getByText('testuser'))
    expect(screen.getByText('Sign out')).toBeInTheDocument()

    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryByText('Sign out')).not.toBeInTheDocument())
  })

  it('opens change password modal from dropdown', async () => {
    const { user } = renderWithProviders(<Header />)
    await user.click(screen.getByText('testuser'))
    await user.click(screen.getByText('Change password'))
    expect(screen.getByPlaceholderText('Current password')).toBeInTheDocument()
  })

  it('submits change password form successfully', async () => {
    const { user } = renderWithProviders(<Header />)
    await user.click(screen.getByText('testuser'))
    await user.click(screen.getByText('Change password'))

    await user.type(screen.getByPlaceholderText('Current password'), 'old')
    await user.type(screen.getByPlaceholderText('New password'), 'newpass')
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'newpass')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    await waitFor(() => expect(screen.getByText('Password changed successfully')).toBeInTheDocument())
  })

  it('shows error when passwords do not match', async () => {
    const { user } = renderWithProviders(<Header />)
    await user.click(screen.getByText('testuser'))
    await user.click(screen.getByText('Change password'))

    await user.type(screen.getByPlaceholderText('Current password'), 'old')
    await user.type(screen.getByPlaceholderText('New password'), 'aaa')
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'bbb')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    expect(screen.getByText("Passwords don't match")).toBeInTheDocument()
  })

  it('shows error when API returns error', async () => {
    server.use(
      http.post(`${BASE}/auth/change-password/`, () =>
        HttpResponse.json({ detail: 'Wrong password' }, { status: 400 }),
      ),
    )
    const { user } = renderWithProviders(<Header />)
    await user.click(screen.getByText('testuser'))
    await user.click(screen.getByText('Change password'))

    await user.type(screen.getByPlaceholderText('Current password'), 'wrong')
    await user.type(screen.getByPlaceholderText('New password'), 'newpass')
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'newpass')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    await waitFor(() => expect(screen.getByText('Wrong password')).toBeInTheDocument())
  })

  it('calls logout and navigates on Sign out', async () => {
    const logout = vi.fn()
    const { user } = renderWithProviders(<Header />, { auth: { logout } })
    await user.click(screen.getByText('testuser'))
    await user.click(screen.getByText('Sign out'))
    expect(logout).toHaveBeenCalled()
  })
})
