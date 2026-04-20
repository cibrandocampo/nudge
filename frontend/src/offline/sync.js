import { api } from '../api/client'
import { ConflictError, OfflineError } from '../api/errors'
import {
  clearAbortController,
  list,
  markConflict,
  markError,
  markPending,
  markRetryPending,
  markSyncing,
  registerAbortController,
  subscribe,
  remove,
} from './queue'

const BACKGROUND_SYNC_TAG = 'nudge-offline-queue'

/**
 * Exponential backoff delays applied to transient HTTP errors
 * (408 / 429 / 5xx). Indexed by the entry's *current* `retryCount`, so the
 * first failure waits `RETRY_DELAYS_MS[0]`, the next `RETRY_DELAYS_MS[1]`,
 * etc. After `MAX_RETRIES` failures the entry is marked `error` and held
 * for manual action from the PendingBadge panel.
 */
export const RETRY_DELAYS_MS = [2_000, 10_000, 30_000]
export const MAX_RETRIES = RETRY_DELAYS_MS.length
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

/**
 * Read the retry backoff schedule, letting tests override it via
 * `window.__NUDGE_SYNC_RETRY_DELAYS_MS__` (T071). Production leaves the
 * global undefined and the default 2s/10s/30s schedule kicks in; E2E
 * specs that want to observe the error-after-retries path shorten the
 * delays to a few hundred ms so the test finishes in seconds, not 42s.
 */
function getRetryDelays() {
  if (
    typeof window !== 'undefined' &&
    Array.isArray(window.__NUDGE_SYNC_RETRY_DELAYS_MS__) &&
    window.__NUDGE_SYNC_RETRY_DELAYS_MS__.length > 0
  ) {
    return window.__NUDGE_SYNC_RETRY_DELAYS_MS__
  }
  return RETRY_DELAYS_MS
}

/**
 * Sync events (T065). The worker emits a `drain-complete` event after a
 * full drain with counters so the UI layer (`useSyncToasts`) can surface
 * "N cambios sincronizados" / "Some changes couldn't sync" toasts
 * without wiring the toast system into the worker itself.
 */
const syncEvents = new EventTarget()

export function subscribeSyncEvents(listener) {
  syncEvents.addEventListener('event', listener)
  return () => syncEvents.removeEventListener('event', listener)
}

function emitSyncEvent(detail) {
  syncEvents.dispatchEvent(new CustomEvent('event', { detail }))
}

/**
 * Register a Background Sync tag with the service worker so the browser can
 * wake up the SW when connectivity returns — even if the tab is in the
 * background or closed. Only implemented in Chromium-family browsers at time
 * of writing; Safari and Firefox rely on the `online` listener below.
 */
export async function registerBackgroundSync() {
  if (!navigator?.serviceWorker) return false
  if (!('SyncManager' in window)) return false
  try {
    const reg = await navigator.serviceWorker.ready
    await reg.sync.register(BACKGROUND_SYNC_TAG)
    return true
  } catch {
    // SyncManager exists but registration failed (denied permission,
    // quota, closed context…). Fall through to the online-event fallback.
    return false
  }
}

/**
 * Sync worker: drains the offline mutation queue in FIFO order whenever the
 * browser reconnects (window 'online' event) or the service worker posts a
 * PROCESS_QUEUE message (T025 Background Sync).
 *
 * Processing is strictly sequential per resource to preserve user intent:
 * if the user edited routine 5 twice while offline, the older PATCH has to
 * land first, otherwise the newer one would be overwritten by the stale one.
 * Serializing across the whole queue (simpler) is enough in practice.
 *
 * On 2xx   → entry removed and focal cache invalidation (T065) fired for
 *            the query keys derived from the entry's `resourceKey`.
 * On 408/429/5xx with retries left (T064) → markRetryPending with backoff
 *            delay (2s → 10s → 30s). The drain schedules a setTimeout for
 *            the earliest `nextAttemptAt` and resumes automatically.
 * On 412   → entry marked `conflict` with server's `current`; stop this run
 *            so the modal (T026) can resolve before retrying.
 * On other 4xx (or retries exhausted) → entry marked `error`; manual
 *            discard from the PendingBadge panel.
 * On network error → entry back to `pending`, abort the run; next `online`
 *                    event retries.
 * On AbortError (entry removed mid-flight, T065) → worker stops without
 *                    marking any status; the entry has already been deleted.
 */

let queryClient = null
let processing = false
// Re-run once more if `online` fires while we're mid-drain. Keeps the worker
// single-flight without dropping the second event.
let rerunRequested = false
// Scheduled wake-up for the next backoff-delayed entry.
let nextDrainTimer = null
// Remember whether the last emit had a pending entry — used to debounce
// `registerBackgroundSync` to the 0 → ≥1 transition only.
let lastHadPending = false

export function setQueryClient(client) {
  queryClient = client
}

/**
 * Derives the TanStack Query keys that a queued mutation could have
 * affected from its `resourceKey`. Post-success the worker invalidates
 * only these keys instead of the whole cache, which is why the old
 * "thundering herd" of blanket invalidations on every drained entry is
 * gone (audit #8).
 */
function queryKeysForResource(resourceKey) {
  if (!resourceKey) return [['dashboard']]
  const [type, rawId] = resourceKey.split(':')
  const id = rawId != null ? Number(rawId) : null
  switch (type) {
    case 'routine':
      return [['dashboard'], ['routines'], ['routine', id], ['routine-entries', id], ['entries']]
    case 'stock':
      return [['dashboard'], ['stock'], ['stock', id], ['stock-consumptions'], ['stock-lots', id]]
    case 'entry':
      return [['entries'], ['routine-entries']]
    case 'consumption':
      return [['stock-consumptions']]
    case 'me':
      return [['me']]
    case 'contact':
      return [['contacts']]
    case 'stock-group':
      return [['stock-groups'], ['stock']]
    default:
      return [['dashboard']]
  }
}

async function runEntry(entry) {
  await markSyncing(entry.id)
  const controller = new AbortController()
  registerAbortController(entry.id, controller)
  const method = entry.method.toLowerCase()
  const opts = {
    idempotencyKey: entry.id,
    ifUnmodifiedSince: entry.ifUnmodifiedSince ?? undefined,
    signal: controller.signal,
  }

  try {
    const res =
      method === 'get' ? await api.get(entry.endpoint, opts) : await api[method](entry.endpoint, entry.body, opts)
    if (res.ok) {
      await remove(entry.id)
      if (queryClient) {
        const keys = queryKeysForResource(entry.resourceKey)
        await Promise.all(keys.map((key) => queryClient.invalidateQueries({ queryKey: key })))
      }
      return 'done'
    }
    if (RETRYABLE_STATUSES.has(res.status)) {
      const delays = getRetryDelays()
      const maxRetries = delays.length
      const currentRetries = entry.retryCount ?? 0
      if (currentRetries < maxRetries) {
        await markRetryPending(entry.id, delays[currentRetries])
        return 'retry'
      }
      await markError(entry.id, `HTTP ${res.status} after ${maxRetries} retries`)
      return 'error'
    }
    await markError(entry.id, `HTTP ${res.status}`)
    return 'error'
  } catch (err) {
    if (err?.name === 'AbortError') {
      // `remove(entry.id)` already cleared the entry from the queue;
      // nothing else to do here.
      return 'aborted'
    }
    if (err instanceof ConflictError) {
      await markConflict(entry.id, err.current)
      return 'conflict'
    }
    if (err instanceof OfflineError) {
      await markPending(entry.id)
      return 'offline'
    }
    await markError(entry.id, err?.message ?? String(err))
    return 'error'
  } finally {
    clearAbortController(entry.id)
  }
}

function scheduleNextDrain(delayMs) {
  if (nextDrainTimer !== null) clearTimeout(nextDrainTimer)
  nextDrainTimer = setTimeout(
    () => {
      nextDrainTimer = null
      void processQueue()
    },
    Math.max(0, delayMs),
  )
}

export async function processQueue() {
  if (processing) {
    rerunRequested = true
    return
  }
  processing = true
  let successCount = 0
  let errorCount = 0
  try {
    // Loop so that entries flipped to 'pending' during this run (after a 2xx
    // another one becomes ready to retry) get picked up.
    let draining = true
    while (draining) {
      const entries = await list()
      const pending = entries.filter((e) => e.status === 'pending')
      if (pending.length === 0) break

      const now = Date.now()
      const ready = pending.filter((e) => !e.nextAttemptAt || Date.parse(e.nextAttemptAt) <= now)
      if (ready.length === 0) {
        // Every pending entry is scheduled for a future retry — schedule a
        // single wake-up at the earliest and stop draining for now.
        const earliest = Math.min(...pending.map((e) => Date.parse(e.nextAttemptAt)))
        scheduleNextDrain(earliest - now)
        break
      }

      const outcome = await runEntry(ready[0])
      if (outcome === 'done') successCount += 1
      else if (outcome === 'error') errorCount += 1
      if (outcome === 'offline' || outcome === 'conflict') draining = false
      // 'retry', 'error' and 'aborted' keep draining — the scheduler picks
      // up retried entries later and other ready entries may still go.
    }
  } finally {
    processing = false
    if (successCount > 0 || errorCount > 0) {
      emitSyncEvent({ type: 'drain-complete', successCount, errorCount })
    }
    if (rerunRequested) {
      rerunRequested = false
      // Fire-and-forget: the next drain runs on its own microtask so this
      // call returns cleanly to its original caller.
      void processQueue()
    }
  }
}

/**
 * Runs bootstrap cleanup (converts orphan `syncing` entries back to
 * `pending`) and then drains the queue. The one-stop entry point for
 * startup and manual retry flows (ConflictModal "Keep mine", PendingBadge
 * "Retry all"). `initSyncWorker` intentionally does NOT call this
 * automatically so tests can set up their own enqueues without racing an
 * in-flight auto-drain; App.jsx fires `forceSync()` right after
 * `initSyncWorker()`.
 */
export async function forceSync() {
  await resetStuckSyncing()
  await processQueue()
}

function onOnline() {
  void processQueue()
}

function onSwMessage(event) {
  if (event?.data?.type === 'PROCESS_QUEUE') {
    void processQueue()
  }
}

let initialised = false
let unsubscribeQueue = null

async function handleQueueChange() {
  // Register a Background Sync tag only when the queue transitions from
  // "no pending work" to "has pending work" (T065). Every emit (including
  // `markSyncing` / `markError` / `remove`) fires this handler, so the
  // naive "if any pending → register" version was spamming `reg.sync.register`
  // dozens of times per drain.
  const entries = await list()
  const hasPending = entries.some((e) => e.status === 'pending')
  if (hasPending && !lastHadPending) {
    void registerBackgroundSync()
  }
  lastHadPending = hasPending
}

/**
 * Bootstrap hygiene (T064): entries that were mid-flight when the previous
 * tab closed (or redirected on 401, or reloaded) stay in `'syncing'` status
 * forever because the drain loop only picks `'pending'`. Restore them on
 * worker init so they actually get retried instead of silently rotting.
 * `markPending` preserves `retryCount` and `nextAttemptAt`.
 */
async function resetStuckSyncing() {
  const all = await list()
  for (const entry of all) {
    if (entry.status === 'syncing') {
      await markPending(entry.id)
    }
  }
}

/**
 * Wire the worker to the runtime. Called once from App.jsx with the app's
 * QueryClient so post-success invalidation can target the right cache.
 */
export function initSyncWorker(client) {
  setQueryClient(client)
  if (initialised) return
  initialised = true
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
  }
  if (typeof navigator !== 'undefined' && navigator.serviceWorker?.addEventListener) {
    navigator.serviceWorker.addEventListener('message', onSwMessage)
  }
  // Re-register a Background Sync tag on every queue change so new work
  // survives tab close. Subscribing here (rather than from every hook) keeps
  // the responsibility in one place.
  unsubscribeQueue = subscribe(handleQueueChange)
  // Bootstrap cleanup runs on init, but the first drain is deferred to
  // `forceSync()` — fired by App.jsx after this function returns. Keeping
  // the drain out of `initSyncWorker` means tests can set up enqueues
  // without racing an already-running drain.
}

/**
 * Tear down listeners — only used in tests so each case starts clean.
 */
export function __resetSyncWorkerForTests() {
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', onOnline)
  }
  if (typeof navigator !== 'undefined' && navigator.serviceWorker?.removeEventListener) {
    navigator.serviceWorker.removeEventListener('message', onSwMessage)
  }
  if (unsubscribeQueue) {
    unsubscribeQueue()
    unsubscribeQueue = null
  }
  if (nextDrainTimer !== null) {
    clearTimeout(nextDrainTimer)
    nextDrainTimer = null
  }
  queryClient = null
  initialised = false
  processing = false
  rerunRequested = false
  lastHadPending = false
}
