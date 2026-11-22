import { useCallback, useEffect, useState } from 'react'

const PUSH_CHANGED = 'nudge:push-changed'

/** Every `usePushStatus` re-reads the real state (each keeps its own copy). */
export function notifyPushChanged() {
  window.dispatchEvent(new Event(PUSH_CHANGED))
}

export function usePushStatus() {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default',
  )
  const [subscribed, setSubscribed] = useState(false)
  // With permission granted, false until the subscription has been read.
  const [checked, setChecked] = useState(false)

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
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') setChecked(true)
  }, [])

  useEffect(() => {
    check()
    window.addEventListener('focus', check)
    window.addEventListener(PUSH_CHANGED, check)
    return () => {
      window.removeEventListener('focus', check)
      window.removeEventListener(PUSH_CHANGED, check)
    }
  }, [check])

  const active = permission === 'granted' && subscribed
  return { permission, subscribed, checked, active, setPermission, setSubscribed }
}
