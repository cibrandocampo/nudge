import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../contexts/AuthContext'
import { ToastProvider } from '../../components/Toast'

const defaultAuth = {
  user: {
    id: 1,
    username: 'testuser',
    is_staff: false,
    timezone: 'Europe/Madrid',
    language: 'en',
    daily_notification_time: '08:00:00',
  },
  login: vi.fn(),
  logout: vi.fn(),
  loading: false,
}

/**
 * Test helper for pages migrated to TanStack Query. Wraps `ui` in a fresh
 * QueryClient (retry off), the ToastProvider, the AuthContext and a
 * MemoryRouter so hook-driven pages render exactly the way App does — just
 * without the persistor + service worker.
 *
 * Returns the RTL render result, augmented with `user` (an initialised
 * userEvent instance) and the effective `authValue` for assertions.
 */
export function renderWithProviders(ui, options = {}) {
  const { auth = {}, initialEntries = ['/'], queryClient, ...renderOptions } = options

  const authValue = { ...defaultAuth, ...auth }
  const qc =
    queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })

  function Wrapper({ children }) {
    return (
      <QueryClientProvider client={qc}>
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
