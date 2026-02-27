import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function ProtectedRoute() {
  const { user, loading } = useAuth()
  // While loading: render the Outlet so Layout (and its nav bar) stays mounted.
  // Only redirect to login once we know for certain there is no authenticated user.
  if (!loading && !user) return <Navigate to="/login" replace />
  return <Outlet />
}
