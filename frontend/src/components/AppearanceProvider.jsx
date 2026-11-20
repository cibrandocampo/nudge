import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { appearanceOf, applyAppearance, storeAppearance } from '../appearance'
import { useAuth } from '../contexts/AuthContext'

/**
 * Applies the profile's theme, text size and language to the whole app (T148).
 *
 * `main.jsx` has already painted this device's last appearance; once
 * `/api/auth/me/` loads, the profile wins and becomes the device's copy. The
 * language used to be applied only when Settings mounted, so a new device
 * showed the browser language until the user opened Settings.
 *
 * Signed out (`user` is null) it does nothing: the login screen keeps the last
 * appearance and language used on this device.
 */
export default function AppearanceProvider({ children }) {
  const { user } = useAuth()
  const { i18n } = useTranslation()
  const signedIn = Boolean(user)
  const theme = user?.theme
  const textSize = user?.text_size
  const language = user?.language

  // Keyed on the fields, not on `user`: a refetch of the same profile is a no-op.
  useEffect(() => {
    if (!signedIn) return
    const appearance = appearanceOf({ theme, text_size: textSize })
    applyAppearance(appearance)
    storeAppearance(appearance)
  }, [signedIn, theme, textSize])

  useEffect(() => {
    if (language && language !== i18n.language) i18n.changeLanguage(language)
  }, [language, i18n])

  return children
}
