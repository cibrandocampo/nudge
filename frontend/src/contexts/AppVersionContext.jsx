import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { registerAppVersionPublisher } from './appVersionBridge'

const AppVersionContext = createContext(null)

// Tracks the latest backend version as reported by the X-App-Version
// response header, exposes `updateAvailable` when it differs from the
// VITE_APP_VERSION baked into this bundle, and registers the publisher
// the api client uses to push values without React-tree access.
export function AppVersionProvider({ children }) {
  const localVersion = import.meta.env.VITE_APP_VERSION ?? 'dev'
  const [latestVersion, setLatestVersion] = useState(null)
  // Mirror of `latestVersion` used inside the imperative publisher so
  // duplicate publishes for the same version don't trigger re-renders.
  const latestRef = useRef(null)

  useEffect(() => {
    return registerAppVersionPublisher((remote) => {
      if (!remote || remote === latestRef.current) return
      latestRef.current = remote
      setLatestVersion(remote)
    })
  }, [])

  const value = useMemo(
    () => ({
      localVersion,
      latestVersion,
      updateAvailable: latestVersion != null && latestVersion !== localVersion,
    }),
    [localVersion, latestVersion],
  )

  return <AppVersionContext.Provider value={value}>{children}</AppVersionContext.Provider>
}

export function useAppVersion() {
  const ctx = useContext(AppVersionContext)
  if (!ctx) throw new Error('useAppVersion must be used inside AppVersionProvider')
  return ctx
}
