import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../components/Toast'
import { AppVersionProvider } from '../contexts/AppVersionContext'
import { AuthContext } from '../contexts/AuthContext'

const defaultAuth = {
  user: {
    id: 1,
    username: 'testuser',
    email: 'testuser@example.com',
    is_staff: false,
    timezone: 'Europe/Madrid',
    language: 'en',
    daily_notification_time: '08:00:00',
  },
  loginStart: vi.fn().mockResolvedValue({ method: 'password' }),
  loginVerify: vi.fn().mockResolvedValue({ is_new: false }),
  completeProfile: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn(),
  loading: false,
  isNewUser: false,
  allowSelfSignup: null,
}

/**
 * Canonical test helper: wraps UI in QueryClientProvider + ToastProvider +
 * AuthContext + MemoryRouter — the same set the live app uses in App.jsx.
 * Each call creates a fresh QueryClient so caches don't leak between tests.
 */
export function renderWithProviders(ui, options = {}) {
  const { auth = {}, initialEntries = ['/'], queryClient, ...renderOptions } = options

  const authValue = { ...defaultAuth, ...auth }
  const qc =
    queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })

  function Wrapper({ children }) {
    return (
      <QueryClientProvider client={qc}>
        <AppVersionProvider>
          <ToastProvider>
            <AuthContext.Provider value={authValue}>
              <MemoryRouter
                initialEntries={initialEntries}
                future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
              >
                {children}
              </MemoryRouter>
            </AuthContext.Provider>
          </ToastProvider>
        </AppVersionProvider>
      </QueryClientProvider>
    )
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    user: userEvent.setup(),
    authValue,
    queryClient: qc,
  }
}

export { default as userEvent } from '@testing-library/user-event'
export * from '@testing-library/react'
