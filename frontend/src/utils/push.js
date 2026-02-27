import { api } from '../api/client'

/**
 * Subscribe the current browser to Web Push and register the subscription
 * with the backend.
 *
 * @param {string} vapidPublicKey  VAPID public key from /api/push/vapid-public-key/
 */
export async function subscribeToPush(vapidPublicKey) {
  const registration = await navigator.serviceWorker.ready

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  })

  const res = await api.post('/push/subscribe/', {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: arrayBufferToBase64(subscription.getKey('p256dh')),
      auth: arrayBufferToBase64(subscription.getKey('auth')),
    },
  })

  if (!res.ok) throw new Error('Failed to register push subscription')
}

/**
 * Unsubscribe the current browser from Web Push and notify the backend.
 */
export async function unsubscribeFromPush() {
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return

  const res = await api.delete('/push/unsubscribe/', { endpoint: subscription.endpoint })

  if (!res.ok && res.status !== 204) throw new Error('Failed to unregister push subscription')

  await subscription.unsubscribe()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)))
}

function arrayBufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
}
