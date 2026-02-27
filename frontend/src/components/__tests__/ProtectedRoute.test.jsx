import { screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom'
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
    renderRoute({ user: null, loading: true, login: vi.fn(), logout: vi.fn() })
    // While loading, Outlet is rendered but no child matches, so neither page shows.
    // Importantly, it does NOT redirect to login.
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument()
  })

  it('redirects to login when not loading and no user', () => {
    renderRoute({ user: null, loading: false, login: vi.fn(), logout: vi.fn() })
    expect(screen.getByText('Login Page')).toBeInTheDocument()
  })

  it('renders child route when user is present', () => {
    renderRoute({ user: { id: 1, username: 'u' }, loading: false, login: vi.fn(), logout: vi.fn() })
    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })
})
