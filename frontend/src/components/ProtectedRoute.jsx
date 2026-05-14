import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function ProtectedRoute() {
  const { user, loading, isNewUser } = useAuth()
  // While loading: render the Outlet so Layout (and its nav bar) stays mounted.
  // Only redirect to login once we know for certain there is no authenticated user.
  if (!loading && !user) return <Navigate to="/login" replace />
  // Onboarding gate: an authenticated user whose first_name AND last_name
  // are empty must finish the signup wizard before reaching any other
  // route. The LoginPage detects `isNewUser` on mount and jumps to the
  // "name" step automatically.
  if (user && isNewUser) return <Navigate to="/login" replace />
  return <Outlet />
}
