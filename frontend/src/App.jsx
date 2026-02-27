import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import RoutineDetailPage from './pages/RoutineDetailPage'
import RoutineFormPage from './pages/RoutineFormPage'
import HistoryPage from './pages/HistoryPage'
import InventoryPage from './pages/InventoryPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/routines/new" element={<RoutineFormPage />} />
              <Route path="/routines/:id" element={<RoutineDetailPage />} />
              <Route path="/routines/:id/edit" element={<RoutineFormPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
