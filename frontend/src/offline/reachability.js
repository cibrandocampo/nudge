/**
 * Observable "can we reach the backend right now?" signal.
 *
 * The source of truth is NOT `navigator.onLine` — captive portals, hotel
 * WiFi, a crashed backend and a broken VPN all report `onLine: true` while
 * being unable to reach the API. Instead:
 *
 * - Every real `api.*` call updates this state: OfflineError -> false,
 *   any HTTP response -> true. See `api/client.js`.
 * - While the state is `false`, a poll to `/api/health/` runs every
 *   `HEALTH_POLL_INTERVAL_MS`. As soon as it returns 2xx, we flip back to
 *   `true` and fire `forceSync()` so the queue drains without waiting for
 *   the next user interaction.
 *
 * The poll uses a raw `fetch` (NOT the project's `api` client) so its
 * success/failure does not recursively update the same state.
 */

import { forceSync } from './sync'

export const HEALTH_POLL_INTERVAL_MS = 20_000

const HEALTH_PATH = '/api/health/'
// Matches the fallback used in api/client.js.
const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'
const HEALTH_URL = `${BASE_URL.replace(/\/api\/?$/, '')}${HEALTH_PATH}`

/**
 * Read the poll interval, letting tests override it via
 * `window.__NUDGE_REACHABILITY_POLL_MS__` (T068). Production leaves it
 * undefined and the default 20s interval kicks in.
 */
function getPollIntervalMs() {
  if (typeof window !== 'undefined' && typeof window.__NUDGE_REACHABILITY_POLL_MS__ === 'number') {
    return window.__NUDGE_REACHABILITY_POLL_MS__
  }
  return HEALTH_POLL_INTERVAL_MS
}

// Initialise from the native network signal so a page that boots while the
// browser already reports offline starts with the banner visible instead
// of waiting on the first failed api call.
let reachable = typeof navigator !== 'undefined' ? navigator.onLine : true
const listeners = new Set()
let pollTimer = null

// The native `offline` event is a lower-bound signal: when it fires the
// browser knows there is no network at all, which is strictly worse than
// "backend not responding". Fold it into the same reachable flag so the
// banner appears even when the Service Worker is able to serve cached
// reads. We deliberately DO NOT handle `online`: coming back to network
// does not prove the backend is up, so let the health poll (started by
// setReachable(false)) verify it.
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => setReachable(false))
}

function notify() {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // A broken listener must not prevent others from being notified.
    }
  }
}

export function getReachable() {
  return reachable
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function probeHealth() {
  try {
    const res = await fetch(HEALTH_URL, { method: 'GET', cache: 'no-store' })
    if (res.ok) {
      // The poll is our authoritative reconnection signal: drain the
      // queue in addition to flipping the state. Passive observations
      // from `api/client` only flip state — they can't trigger a drain
      // because the in-flight user action is already doing the work.
      setReachable(true)
      void forceSync()
    }
  } catch {
    // Still unreachable — keep polling.
  }
}

function startPoll() {
  if (pollTimer !== null) return
  pollTimer = setInterval(probeHealth, getPollIntervalMs())
}

function stopPoll() {
  if (pollTimer === null) return
  clearInterval(pollTimer)
  pollTimer = null
}

export function setReachable(value) {
  // Dev-only E2E lock: when tests need to force a stable reachability
  // state they set `window.__NUDGE_REACHABILITY_LOCK__ = true` so
  // subsequent passive observations (SW-cached 200s, health poll
  // success, api-client success paths) can't flip the state back. No
  // effect in production — the global simply isn't set.
  if (typeof window !== 'undefined' && window.__NUDGE_REACHABILITY_LOCK__ === true) {
    return
  }
  // Cannot be reachable while the browser itself reports offline — the
  // Service Worker can serve cached 200s and make callers believe the
  // backend is up. Reject the flip; the native `online` event + health
  // poll will flip it back the moment the network recovers.
  if (value === true && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return
  }
  const next = Boolean(value)
  if (next === reachable) return
  reachable = next
  if (reachable) {
    stopPoll()
  } else {
    startPoll()
  }
  notify()
}

export function __resetForTests() {
  stopPoll()
  listeners.clear()
  reachable = true
}

// Expose a setter on `window` in dev or when a preview build was made for
// E2E (VITE_E2E_MODE=true). Playwright helpers use it to force the
// reachability flag without waiting on a poll or simulating fetch failures.
// Stripped in regular production builds — both `import.meta.env.DEV` and
// the flag resolve to falsy so Rollup eliminates the dead branch.
if (typeof window !== 'undefined' && (import.meta.env.DEV || import.meta.env.VITE_E2E_MODE === 'true')) {
  window.__NUDGE_REACHABILITY_SET__ = setReachable
}
