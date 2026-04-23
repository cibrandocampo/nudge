import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import Header from '../Header'

describe('Header', () => {
  it('shows nudge logo', () => {
    renderWithProviders(<Header />)
    expect(screen.getByText('nudge')).toBeInTheDocument()
  })

  it('renders a Sign out button', () => {
    renderWithProviders(<Header />)
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('shows Admin button for staff users', () => {
    renderWithProviders(<Header />, {
      auth: { user: { id: 1, username: 'admin', is_staff: true } },
    })
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('hides Admin button for non-staff users', () => {
    renderWithProviders(<Header />)
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  })

  it('Admin button calls goToAdmin which submits a form', async () => {
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

  it('calls logout when Sign out is clicked', async () => {
    const logout = vi.fn()
    const { user } = renderWithProviders(<Header />, { auth: { logout } })
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(logout).toHaveBeenCalled())
  })
})
