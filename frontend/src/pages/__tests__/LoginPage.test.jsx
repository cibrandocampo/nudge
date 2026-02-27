import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import LoginPage from '../LoginPage'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders form with username and password fields', () => {
    renderWithProviders(<LoginPage />)
    expect(screen.getByPlaceholderText('Username')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument()
    expect(screen.getByText('Sign in')).toBeInTheDocument()
  })

  it('renders tagline', () => {
    renderWithProviders(<LoginPage />)
    expect(screen.getByText('A gentle reminder for recurring things.')).toBeInTheDocument()
  })

  it('navigates to / on successful login', async () => {
    const login = vi.fn().mockResolvedValue(undefined)
    const { user } = renderWithProviders(<LoginPage />, { auth: { login } })

    await user.type(screen.getByPlaceholderText('Username'), 'testuser')
    await user.type(screen.getByPlaceholderText('Password'), 'pass')
    await user.click(screen.getByText('Sign in'))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'))
    expect(login).toHaveBeenCalledWith('testuser', 'pass')
  })

  it('shows error on failed login', async () => {
    const login = vi.fn().mockRejectedValue(new Error('fail'))
    const { user } = renderWithProviders(<LoginPage />, { auth: { login } })

    await user.type(screen.getByPlaceholderText('Username'), 'bad')
    await user.type(screen.getByPlaceholderText('Password'), 'bad')
    await user.click(screen.getByText('Sign in'))

    await waitFor(() => expect(screen.getByText('Invalid username or password.')).toBeInTheDocument())
  })

  it('shows loading state while submitting', async () => {
    let resolveLogin
    const login = vi.fn().mockImplementation(
      () =>
        new Promise((r) => {
          resolveLogin = r
        }),
    )
    const { user } = renderWithProviders(<LoginPage />, { auth: { login } })

    await user.type(screen.getByPlaceholderText('Username'), 'u')
    await user.type(screen.getByPlaceholderText('Password'), 'p')
    await user.click(screen.getByText('Sign in'))

    expect(screen.getByText('Signing in…')).toBeDisabled()

    resolveLogin()
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
  })
})
