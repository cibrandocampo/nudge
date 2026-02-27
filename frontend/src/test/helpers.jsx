import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../contexts/AuthContext'

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

export function renderWithProviders(ui, options = {}) {
  const { auth = {}, initialEntries = ['/'], ...renderOptions } = options

  const authValue = { ...defaultAuth, ...auth }

  function Wrapper({ children }) {
    return (
      <AuthContext.Provider value={authValue}>
        <MemoryRouter initialEntries={initialEntries} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          {children}
        </MemoryRouter>
      </AuthContext.Provider>
    )
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    user: userEvent.setup(),
    authValue,
  }
}

export { default as userEvent } from '@testing-library/user-event'
export * from '@testing-library/react'
