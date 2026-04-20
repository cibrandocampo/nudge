import { expect } from '@playwright/test'

/**
 * Simulate going offline. Besides toggling Playwright's network state,
 * this override shortens the reachability poll to 500 ms and forces the
 * client-side `reachable` flag to `false`, so the `OfflineBanner` mounts
 * immediately without waiting for the default 20 s poll.
 */
export async function goOffline(page, context) {
  await page.evaluate(() => {
    window.__NUDGE_REACHABILITY_POLL_MS__ = 500
  })
  await context.setOffline(true)
  await page.evaluate(() => {
    // Unlock first so our setReachable(false) takes effect, then lock
    // so subsequent passive observations (SW-cached 200s, health poll)
    // cannot flip the flag back to true.
    window.__NUDGE_REACHABILITY_LOCK__ = false
    if (typeof window.__NUDGE_REACHABILITY_SET__ === 'function') {
      window.__NUDGE_REACHABILITY_SET__(false)
    }
    window.__NUDGE_REACHABILITY_LOCK__ = true
  })
}

/**
 * Bring the page back online. Flips Playwright's network + forces
 * `reachable=true` so the banner disappears without waiting for the next
 * poll. Playwright's own `online` event then fires `processQueue()`
 * inside the sync worker.
 */
export async function goOnline(page, context) {
  await context.setOffline(false)
  await page.evaluate(() => {
    // Unlock first; the setReachable(true) call flips the state and then
    // normal passive observations take over.
    window.__NUDGE_REACHABILITY_LOCK__ = false
    if (typeof window.__NUDGE_REACHABILITY_SET__ === 'function') {
      window.__NUDGE_REACHABILITY_SET__(true)
    }
  })
}

/**
 * Block until a Service Worker is active AND controlling this page.
 * Offline flows (cache + background sync) require the controller —
 * otherwise `setOffline(true)` leaves the page unable to read from
 * cache. Nudge's SW (`frontend/src/sw.js`) does not call `clients.claim()`,
 * so on the first load the SW activates but does not control the page;
 * we trigger a reload to let it take over.
 */
export async function waitForServiceWorkerReady(page, { timeout = 10_000 } = {}) {
  // Wait for the SW to be installed and activated (registration exists).
  await page.waitForFunction(
    async () => {
      const reg = await navigator.serviceWorker?.ready
      return !!reg?.active
    },
    { timeout },
  )
  // If the SW is not yet controlling this page (common on first load of
  // a fresh session), reload so the active worker claims us.
  const hasController = await page.evaluate(() => !!navigator.serviceWorker?.controller)
  if (!hasController) {
    await page.reload()
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, { timeout })
  }
}

export async function expectOfflineBanner(page, { visible }) {
  const banner = page.getByTestId('offline-banner')
  if (visible) await banner.waitFor({ state: 'visible' })
  else await banner.waitFor({ state: 'hidden' })
}

/**
 * Assert the PendingBadge state by its `data-count` attribute. Passing
 * `count: 0` means "badge should not be in the DOM" (PendingBadge renders
 * `null` when `entries.length === 0`).
 */
export async function expectPendingBadge(page, { count }) {
  const badge = page.getByTestId('pending-badge')
  if (count === 0) {
    await expect(badge).toHaveCount(0)
  } else {
    await expect(badge).toHaveAttribute('data-count', String(count))
  }
}

/**
 * Wait for the PendingBadge to disappear. PendingBadge only renders when
 * the queue has entries; when the last one drains the whole component
 * returns `null`, so `toHaveCount(0)` is the right signal.
 */
export async function waitForSyncDrain(page, { timeout = 15_000 } = {}) {
  await expect(page.getByTestId('pending-badge')).toHaveCount(0, { timeout })
}

/**
 * Install a scoped HTTP mock with automatic cleanup and a "respond N
 * times, then fall through to the real backend" mode, used by backoff
 * and conflict tests. Returns an async cleanup function.
 *
 * @param {{
 *   method: 'GET'|'POST'|'PATCH'|'DELETE',
 *   urlPattern: string | RegExp,
 *   status: number,
 *   body?: unknown,
 *   times?: number,
 * }} opts
 */
export function mockApiRoute(page, { method, urlPattern, status, body, times = Infinity }) {
  // Route on the context, not the page — `page.route` does not intercept
  // fetches made from inside the Service Worker, so mocks targeting
  // `/api/*` endpoints leak through when the SW handles them.
  const context = page.context()
  let count = 0
  const handler = (route) => {
    if (route.request().method() !== method) return route.continue()
    if (count >= times) return route.continue()
    count += 1
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body ?? {}),
    })
  }
  context.route(urlPattern, handler)
  return async () => {
    await context.unroute(urlPattern, handler)
  }
}

/**
 * Set up a 412 conflict on a routine rename and leave the test with the
 * ConflictModal open. The modal only surfaces for mutations replayed by
 * the sync worker (online 412s throw ConflictError directly); to reach
 * that state we go offline, enqueue the rename, come back online under
 * a 412 mock, and wait for the queue entry to enter `conflict` status.
 *
 * Returns the cleanup function for the mock so the caller can release
 * the route before replaying against the real backend (overwrite path).
 *
 * @param {{ newName?: string }} opts
 */
export async function openConflictOnRoutineRename(
  page,
  context,
  routineId,
  { newName = `conflict-${Date.now()}` } = {},
) {
  await page.goto(`/routines/${routineId}`)
  await page.getByRole('link', { name: 'Edit' }).click()
  await page.waitForURL(new RegExp(`/routines/${routineId}/edit$`))

  // Take the page offline so the Save click enqueues instead of hitting
  // the backend directly. A direct 412 online would throw ConflictError
  // and never reach the sync worker's queue path where ConflictOrchestrator
  // picks the entry up.
  await goOffline(page, context)

  const nameInput = page.getByPlaceholder(/change water filter/i)
  await nameInput.clear()
  await nameInput.fill(newName)
  await page.getByRole('button', { name: 'Save' }).click()

  // Arm the 412 mock before coming online so the first sync attempt
  // collides deterministically.
  const cleanup = mockApiRoute(page, {
    method: 'PATCH',
    urlPattern: new RegExp(`/api/routines/${routineId}/$`),
    status: 412,
    body: {
      error: 'conflict',
      current: {
        id: Number(routineId),
        name: 'Server version',
        updated_at: new Date().toISOString(),
      },
    },
  })

  await goOnline(page, context)
  // Worker picks up the pending entry → fires PATCH → 412 →
  // marks conflict → ConflictOrchestrator mounts the modal.
  await page.getByTestId('conflict-modal').waitFor({ state: 'visible' })
  return cleanup
}
