import { useCallback, useEffect, useState } from 'react'

export function usePushStatus() {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default',
  )
  const [subscribed, setSubscribed] = useState(false)

  const check = useCallback(async () => {
    if (typeof Notification !== 'undefined') {
      setPermission(Notification.permission)
    }
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        setSubscribed(Boolean(sub))
      } catch {
        setSubscribed(false)
      }
    }
  }, [])

  useEffect(() => {
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [check])

  const active = permission === 'granted' && subscribed
  return { permission, subscribed, active, setPermission, setSubscribed }
}
