// Hard reload that survives a stale Service Worker / poisoned caches.
// Each step is best-effort: failures are swallowed so we always reach
// `location.reload()` — the worst case is a normal browser refresh,
// which is still better than leaving the user on a stale bundle.
export async function forceReload() {
  try {
    if (typeof caches !== 'undefined' && caches?.keys) {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    }
  } catch {
    // Cache API not available or denied — fall through.
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    await reg?.unregister()
  } catch {
    // No SW or unregister failed — fall through.
  }
  window.location.reload()
}
