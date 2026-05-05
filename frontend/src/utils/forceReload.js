// Hard reload that wipes the SW precache before reloading. Failures are
// swallowed so we always reach `location.reload()` — the worst case is a
// normal browser refresh, which is still better than leaving the user on
// a stale bundle.
//
// We do NOT unregister the Service Worker. `vite-plugin-pwa`'s autoUpdate
// mode injects `skipWaiting` + `clients.claim`, so the new SW activates
// on its own. Unregistering destroys the `ServiceWorkerRegistration` and
// with it the `PushSubscription`, which would silently revoke push for
// every user on every release.
export async function forceReload() {
  try {
    if (typeof caches !== 'undefined' && caches?.keys) {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    }
  } catch {
    // Cache API not available or denied — fall through.
  }
  window.location.reload()
}
