import { screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render } from '@testing-library/react'
import { AuthContext } from '../../contexts/AuthContext'
import ProtectedRoute from '../ProtectedRoute'

function renderRoute(authValue, initialEntries = ['/protected']) {
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={initialEntries} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/protected" element={<div>Protected Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('ProtectedRoute', () => {
  it('renders outlet when loading (keeps layout mounted)', () => {
    renderRoute({ user: null, loading: true, isNewUser: false, logout: vi.fn() })
    // While loading, Outlet is rendered but no child matches, so neither page shows.
    // Importantly, it does NOT redirect to login.
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument()
  })

  it('redirects to login when not loading and no user', () => {
    renderRoute({ user: null, loading: false, isNewUser: false, logout: vi.fn() })
    expect(screen.getByText('Login Page')).toBeInTheDocument()
  })

  it('renders child route when user is present and onboarding is complete', () => {
    renderRoute({
      user: { id: 1, username: 'u', first_name: 'Ada', last_name: 'Lovelace' },
      loading: false,
      isNewUser: false,
      logout: vi.fn(),
    })
    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })

  it('redirects to /login when user is authenticated but isNewUser is true', () => {
    // Onboarding gate (T196): a logged-in user whose first_name AND last_name
    // are still empty must complete the signup wizard before reaching any
    // protected route. The LoginPage will detect `isNewUser` on mount and
    // jump straight to the "name" step.
    renderRoute({
      user: { id: 1, username: 'u', first_name: '', last_name: '' },
      loading: false,
      isNewUser: true,
      logout: vi.fn(),
    })
    expect(screen.getByText('Login Page')).toBeInTheDocument()
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })
})
