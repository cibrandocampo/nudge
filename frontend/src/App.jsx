import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { AuthProvider } from './contexts/AuthContext'
import ConflictOrchestrator from './components/ConflictOrchestrator'
import Layout from './components/Layout'
import OfflineBanner from './components/OfflineBanner'
import ProtectedRoute from './components/ProtectedRoute'
import { ToastProvider } from './components/Toast'
import { useSyncToasts } from './hooks/useSyncToasts'
import { forceSync, initSyncWorker } from './offline/sync'
import { persistOptions, queryClient } from './query/queryClient'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import RoutineDetailPage from './pages/RoutineDetailPage'
import RoutineFormPage from './pages/RoutineFormPage'
import HistoryPage from './pages/HistoryPage'
import InventoryPage from './pages/InventoryPage'
import SettingsPage from './pages/SettingsPage'
import StockDetailPage from './pages/StockDetailPage'

function AppRuntime() {
  // `useSyncToasts` must be mounted inside ToastProvider — keep it in a
  // dedicated child so the surrounding providers don't have to care.
  useSyncToasts()
  useEffect(() => {
    initSyncWorker(queryClient)
    // Fire the first drain after init: bootstrap cleanup of any orphan
    // `syncing` entries from a previous session + replay whatever is
    // queued if the browser is already online.
    void forceSync()
  }, [])
  return null
}

export default function App() {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <ToastProvider>
        <AppRuntime />
        <AuthProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <OfflineBanner />
            <ConflictOrchestrator />
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
                  <Route path="/inventory/:id" element={<StockDetailPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </PersistQueryClientProvider>
  )
}
