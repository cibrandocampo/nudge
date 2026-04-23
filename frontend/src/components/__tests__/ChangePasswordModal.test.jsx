import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import ChangePasswordModal from '../ChangePasswordModal'

const BASE = 'http://localhost/api'

describe('ChangePasswordModal', () => {
  it('renders the form fields', () => {
    renderWithProviders(<ChangePasswordModal onClose={vi.fn()} />)
    expect(screen.getByPlaceholderText('Current password')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('New password')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Confirm new password')).toBeInTheDocument()
  })

  it('submits successfully and shows the confirmation', async () => {
    const { user } = renderWithProviders(<ChangePasswordModal onClose={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('Current password'), 'old')
    await user.type(screen.getByPlaceholderText('New password'), 'newpass')
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'newpass')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    await waitFor(() => expect(screen.getByText('Password changed successfully')).toBeInTheDocument())
  })

  it("shows error when passwords don't match", async () => {
    const { user } = renderWithProviders(<ChangePasswordModal onClose={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('Current password'), 'old')
    await user.type(screen.getByPlaceholderText('New password'), 'aaa')
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'bbb')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(screen.getByText("Passwords don't match")).toBeInTheDocument()
  })

  it('shows the server error detail when the API returns one', async () => {
    server.use(
      http.post(`${BASE}/auth/change-password/`, () =>
        HttpResponse.json({ detail: 'Wrong password' }, { status: 400 }),
      ),
    )
    const { user } = renderWithProviders(<ChangePasswordModal onClose={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('Current password'), 'wrong')
    await user.type(screen.getByPlaceholderText('New password'), 'newpass')
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'newpass')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    await waitFor(() => expect(screen.getByText('Wrong password')).toBeInTheDocument())
  })

  it('falls back to a generic error when the API has no detail', async () => {
    server.use(http.post(`${BASE}/auth/change-password/`, () => HttpResponse.json({}, { status: 400 })))
    const { user } = renderWithProviders(<ChangePasswordModal onClose={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('Current password'), 'wrong')
    await user.type(screen.getByPlaceholderText('New password'), 'newpass')
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'newpass')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    await waitFor(() => expect(screen.getByText('Incorrect current password')).toBeInTheDocument())
  })
})
