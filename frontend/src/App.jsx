import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { AppVersionProvider } from './contexts/AppVersionContext'
import { AuthProvider } from './contexts/AuthContext'
import ConflictOrchestrator from './components/ConflictOrchestrator'
import IconsSprite from './components/IconsSprite'
import Layout from './components/Layout'
import OfflineRouteGuard from './components/OfflineRouteGuard'
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
import StockFormPage from './pages/StockFormPage'
import StockGroupsPage from './pages/StockGroupsPage'

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
      <AppVersionProvider>
        <IconsSprite />
        <ToastProvider>
          <AppRuntime />
          <AuthProvider>
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <ConflictOrchestrator />
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<ProtectedRoute />}>
                  <Route element={<Layout />}>
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/routines/new" element={<RoutineFormPage />} />
                    <Route path="/routines/:id" element={<RoutineDetailPage />} />
                    <Route path="/routines/:id/edit" element={<RoutineFormPage />} />
                    <Route
                      path="/history"
                      element={
                        <OfflineRouteGuard>
                          <HistoryPage />
                        </OfflineRouteGuard>
                      }
                    />
                    <Route path="/inventory" element={<InventoryPage />} />
                    <Route path="/inventory/new" element={<StockFormPage />} />
                    <Route path="/inventory/groups" element={<StockGroupsPage />} />
                    <Route path="/inventory/:id" element={<StockDetailPage />} />
                    <Route path="/inventory/:id/edit" element={<StockFormPage />} />
                    <Route
                      path="/settings"
                      element={
                        <OfflineRouteGuard>
                          <SettingsPage />
                        </OfflineRouteGuard>
                      }
                    />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </AppVersionProvider>
    </PersistQueryClientProvider>
  )
}
