import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { mockFinePointer, renderWithProviders } from '../../test/helpers'
import ChangePasswordModal from '../ChangePasswordModal'

const BASE = 'http://localhost/api'

describe('ChangePasswordModal', () => {
  const fill = async (user, current, next, confirm) => {
    await user.type(screen.getByLabelText('Current password'), current)
    await user.type(screen.getByLabelText('New password'), next)
    await user.type(screen.getByLabelText('Confirm new password'), confirm)
    await user.click(screen.getByRole('button', { name: 'Change password' }))
  }

  it('focuses Confirm when the passwords do not match', async () => {
    const { user } = renderWithProviders(<ChangePasswordModal onClose={vi.fn()} />)
    await fill(user, 'old', 'aaa', 'bbb')
    expect(screen.getByLabelText('Confirm new password')).toHaveFocus()
    expect(screen.getByLabelText('Confirm new password')).toHaveAccessibleDescription("Passwords don't match")
  })

  it('focuses Current when the server refuses the current password', async () => {
    server.use(
      http.post(`${BASE}/auth/change-password/`, () =>
        HttpResponse.json({ detail: 'Incorrect current password.' }, { status: 400 }),
      ),
    )
    const { user } = renderWithProviders(<ChangePasswordModal onClose={vi.fn()} />)
    await fill(user, 'old', 'aaa', 'aaa')
    await waitFor(() => expect(screen.getByLabelText('Current password')).toHaveFocus())
  })

  it('focuses New when the server refuses the new password', async () => {
    server.use(
      http.post(`${BASE}/auth/change-password/`, () =>
        HttpResponse.json({ detail: 'This password is too short.' }, { status: 400 }),
      ),
    )
    const { user } = renderWithProviders(<ChangePasswordModal onClose={vi.fn()} />)
    await fill(user, 'old', 'aaa', 'aaa')
    await waitFor(() => expect(screen.getByLabelText('New password')).toHaveFocus())
  })

  it('does not open the keyboard by itself on a touch screen', () => {
    renderWithProviders(<ChangePasswordModal onClose={vi.fn()} />)
    expect(screen.getByLabelText('Current password')).not.toHaveFocus()
  })

  it('focuses the first field with a mouse', () => {
    mockFinePointer()
    renderWithProviders(<ChangePasswordModal onClose={vi.fn()} />)
    expect(screen.getByLabelText('Current password')).toHaveFocus()
  })

  it('renders the form fields', () => {
    renderWithProviders(<ChangePasswordModal onClose={vi.fn()} />)
    expect(screen.getByLabelText('Current password')).toBeInTheDocument()
    expect(screen.getByLabelText('New password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm new password')).toBeInTheDocument()
  })

  it('submits successfully and shows the confirmation', async () => {
    const { user } = renderWithProviders(<ChangePasswordModal onClose={vi.fn()} />)
    await user.type(screen.getByLabelText('Current password'), 'old')
    await user.type(screen.getByLabelText('New password'), 'newpass')
    await user.type(screen.getByLabelText('Confirm new password'), 'newpass')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    await waitFor(() => expect(screen.getByText('Password changed successfully')).toBeInTheDocument())
  })

  it("shows error when passwords don't match", async () => {
    const { user } = renderWithProviders(<ChangePasswordModal onClose={vi.fn()} />)
    await user.type(screen.getByLabelText('Current password'), 'old')
    await user.type(screen.getByLabelText('New password'), 'aaa')
    await user.type(screen.getByLabelText('Confirm new password'), 'bbb')
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
    await user.type(screen.getByLabelText('Current password'), 'wrong')
    await user.type(screen.getByLabelText('New password'), 'newpass')
    await user.type(screen.getByLabelText('Confirm new password'), 'newpass')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    await waitFor(() => expect(screen.getByText('Wrong password')).toBeInTheDocument())
  })

  it('explains a throttled attempt in the app language, not with the server text', async () => {
    server.use(
      http.post(`${BASE}/auth/change-password/`, () =>
        HttpResponse.json({ detail: 'Request was throttled. Expected available in 3599 seconds.' }, { status: 429 }),
      ),
    )
    const { user } = renderWithProviders(<ChangePasswordModal onClose={vi.fn()} />)
    await user.type(screen.getByLabelText('Current password'), 'wrong')
    await user.type(screen.getByLabelText('New password'), 'newpass')
    await user.type(screen.getByLabelText('Confirm new password'), 'newpass')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('Too many attempts. Try again later.')).toBeInTheDocument()
  })

  it('falls back to a generic error when the API has no detail', async () => {
    server.use(http.post(`${BASE}/auth/change-password/`, () => HttpResponse.json({}, { status: 400 })))
    const { user } = renderWithProviders(<ChangePasswordModal onClose={vi.fn()} />)
    await user.type(screen.getByLabelText('Current password'), 'wrong')
    await user.type(screen.getByLabelText('New password'), 'newpass')
    await user.type(screen.getByLabelText('Confirm new password'), 'newpass')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    await waitFor(() => expect(screen.getByText('Incorrect current password')).toBeInTheDocument())
  })
})
