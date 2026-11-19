/**
 * Marks responses the service worker serves from its API cache instead of
 * the network, so `api/client.js` never mistakes them for a live backend.
 *
 * Kept out of `sw.js` so it can be tested (a service worker has no test
 * harness here); Vite bundles it into the worker.
 *
 *   - `X-From-Cache: offline` — NetworkFirst fell back to the cache because
 *     the network failed or timed out: the backend did not answer.
 *   - `X-From-Cache: 1` — a cached 200 served in place of a 502/503/504
 *     (`gatewayErrorFallbackPlugin` in `sw.js`): the proxy answered, the
 *     upstream did not.
 */
export const FROM_CACHE_HEADER = 'X-From-Cache'
export const FROM_CACHE_OFFLINE = 'offline'
export const FROM_CACHE_GATEWAY = '1'

/** A copy of `response` carrying the marker (cache hits have immutable headers). */
export async function markFromCache(response, value) {
  const headers = new Headers(response.headers)
  headers.set(FROM_CACHE_HEADER, value)
  const body = await response.arrayBuffer()
  return new Response(body, { status: response.status, statusText: response.statusText, headers })
}

/**
 * Workbox plugin: NetworkFirst only reads its cache when the network failed
 * or timed out, so every cached response it is about to use is an offline
 * fallback. Must run after `ExpirationPlugin`, which may drop a stale entry.
 */
export const offlineFallbackMarkerPlugin = {
  cachedResponseWillBeUsed: async ({ cachedResponse }) =>
    cachedResponse ? markFromCache(cachedResponse, FROM_CACHE_OFFLINE) : cachedResponse,
}
