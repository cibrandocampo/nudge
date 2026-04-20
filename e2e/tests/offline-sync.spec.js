import { test, expect } from '@playwright/test'
import {
  SEED,
  freshSession,
  resetSeed,
  goOffline,
  goOnline,
  waitForServiceWorkerReady,
  expectPendingBadge,
  waitForSyncDrain,
  mockApiRoute,
  openConflictOnRoutineRename,
  routineCard,
} from './helpers.js'

/**
 * T071 — Offline sync worker edge cases.
 *
 * Covers the sync machinery (offline/sync.js) under adverse conditions:
 *   · transient 429 with backoff → recovers.
 *   · persistent 503 exhausts retries → entry enters `error` state.
 *   · 412 → ConflictModal diff → overwrite replays against real backend.
 *   · 412 → discard drops the entry and rehydrates server data.
 *   · discard while in-flight aborts the fetch; remaining entries drain.
 *
 * Every test seeds a fresh backend state so mutations don't cascade
 * across the suite (`resetSeed`), and each uses overrides to compress
 * the 2s/10s/30s production backoff into sub-second delays — the test
 * is about the state machine, not the real-world timings.
 */
test.describe('offline-sync', () => {
  test.beforeEach(async ({ page, context }) => {
    await resetSeed(context)
    await freshSession(page, context, { loginAs: 'user1' })
    await waitForServiceWorkerReady(page)
    await expect(routineCard(page, 'morningStretch')).toBeVisible()
  })

  test('429 transitorio reintenta y sincroniza', async ({ page, context }) => {
    // A single-element delay list bounds the worker to one retry — the
    // second attempt must be the one that flips the cached 429 for the
    // real backend's 200.
    await page.evaluate(() => {
      window.__NUDGE_SYNC_RETRY_DELAYS_MS__ = [300]
    })

    await goOffline(page, context)
    await routineCard(page, 'morningStretch').getByRole('button', { name: 'Done' }).click()
    await expectPendingBadge(page, { count: 1 })

    // Respond 429 exactly once; subsequent requests pass through to the
    // real backend (where the POST actually records the entry).
    const cleanup = mockApiRoute(page, {
      method: 'POST',
      urlPattern: '**/api/routines/*/log/',
      status: 429,
      body: { detail: 'throttled' },
      times: 1,
    })

    await goOnline(page, context)
    // First pass: 429 → retry scheduled (300 ms). Second pass: 200 → drain.
    await waitForSyncDrain(page, { timeout: 5_000 })
    await cleanup()
  })

  test('503 persistente agota retries y marca entry como error', async ({ page, context }) => {
    // Three short delays compress the full retry ladder (attempts 0..3)
    // into ~600 ms total, well below the per-test timeout.
    await page.evaluate(() => {
      window.__NUDGE_SYNC_RETRY_DELAYS_MS__ = [50, 100, 150]
    })

    await goOffline(page, context)
    await routineCard(page, 'morningStretch').getByRole('button', { name: 'Done' }).click()
    await expectPendingBadge(page, { count: 1 })

    const cleanup = mockApiRoute(page, {
      method: 'POST',
      urlPattern: '**/api/routines/*/log/',
      status: 503,
      body: { detail: 'service unavailable' },
    })

    await goOnline(page, context)

    // After the ladder is exhausted, the entry is promoted to `error` and
    // the badge's data-state reflects that so the user knows to act.
    const badge = page.getByTestId('pending-badge')
    await expect(badge).toHaveAttribute('data-state', 'error', { timeout: 5_000 })

    await cleanup()
  })

  test('ConflictModal diff + overwrite replay llega al backend', async ({ page, context }) => {
    await page.goto('/')
    await routineCard(page, 'takeVitamins').first().click()
    await expect(page).toHaveURL(/\/routines\/\d+$/)
    const routineId = page.url().match(/routines\/(\d+)/)?.[1]
    expect(routineId).toBeDefined()

    const cleanupMock = await openConflictOnRoutineRename(page, context, routineId, { newName: 'overwrite-me' })

    // Diff must surface the `name` field (the only one we changed).
    await expect(page.getByTestId('conflict-diff-field-name')).toBeVisible()

    // Release the 412 mock BEFORE clicking overwrite so the retry
    // (with the server's `updated_at` from the mock body) replays
    // against the real backend and settles with 200.
    await cleanupMock()
    await page.getByTestId('conflict-action-overwrite').click()

    await expect(page.getByTestId('conflict-modal')).toBeHidden()
    await waitForSyncDrain(page, { timeout: 5_000 })
  })

  test('ConflictModal discard descarta la mutación y rehidrata', async ({ page, context }) => {
    await page.goto('/')
    await routineCard(page, 'takeVitamins').first().click()
    const routineId = page.url().match(/routines\/(\d+)/)?.[1]

    const cleanupMock = await openConflictOnRoutineRename(page, context, routineId, { newName: 'discard-me' })

    await page.getByTestId('conflict-action-discard').click()
    await expect(page.getByTestId('conflict-modal')).toBeHidden()
    await expectPendingBadge(page, { count: 0 })

    // Discard invalidates every query → the routine detail refetches from
    // the real backend, which still holds the seed value. The rename form
    // binds its input to the refetched `routine.name` via useEffect.
    await cleanupMock()
    await page.goto(`/routines/${routineId}/edit`)
    await expect(page.getByPlaceholder(/change water filter/i)).toHaveValue(SEED.routines.takeVitamins)
  })

  test('discard en vuelo aborta la entry activa; resto drena', async ({ page, context }) => {
    // Two independent due routines so the worker processes them
    // sequentially: the first hangs on the mock, the second passes
    // through untouched once the first is discarded.
    await goOffline(page, context)
    await routineCard(page, 'morningStretch').getByRole('button', { name: 'Done' }).click()
    await routineCard(page, 'waterFilter').getByRole('button', { name: 'Done' }).click()
    await expectPendingBadge(page, { count: 2 })

    // Delay only the first POST; further POSTs pass straight to the
    // backend so the second entry drains without extra latency.
    let count = 0
    await context.route('**/api/routines/*/log/', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      count += 1
      if (count === 1) {
        await new Promise((resolve) => setTimeout(resolve, 8_000))
        return route.continue()
      }
      return route.continue()
    })

    await goOnline(page, context)

    // Open the pending panel and click discard on the first (in-flight)
    // entry. `remove()` calls abort() on the registered controller,
    // which causes the worker's fetch to reject with AbortError; the
    // worker moves on to the next pending entry.
    await page.getByTestId('pending-badge').click()
    await page.getByRole('button', { name: 'Discard' }).first().click()

    await waitForSyncDrain(page, { timeout: 15_000 })
    await context.unroute('**/api/routines/*/log/')
  })
})
