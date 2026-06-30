import { test, expect } from '@playwright/test'
import {
  SEED,
  freshSession,
  goOffline,
  goOnline,
  resetSeed,
  waitForServiceWorkerReady,
  expectOfflineBanner,
  expectPendingBadge,
  waitForSyncDrain,
  routineCard,
} from './helpers.js'

/**
 * T070 — Offline mutations + queue + online-only soft block.
 *
 * Each test asserts a single behaviour of the mutation layer from the
 * offline-hardening plan: optimistic updates, queue persistence across
 * reloads, optimistic rollback on 4xx, disabled "New" buttons offline,
 * Settings soft block, online-only graceful failure, and queued entry
 * note edits. T069 covers pure-read scenarios; T071 covers sync worker
 * edge cases (backoff, conflicts, abort).
 */
test.describe('offline-mutations', () => {
  test.beforeEach(async ({ page, context }) => {
    // Reset backend state per-test. Mutation tests (mark done, rename,
    // edit note) leave real data behind; without this, a later test sees
    // polluted entries and `.first()` matchers land on the wrong row.
    // Mirrors the pattern offline-sync.spec.js uses for the same reason.
    await resetSeed(context)
    await freshSession(page, context, { loginAs: 'user1' })
    await waitForServiceWorkerReady(page)
    await expect(routineCard(page, 'takeVitaminD')).toBeVisible()
  })

  test('mark done online: optimistic removal del Today + persistencia tras reload', async ({ page }) => {
    // Use `Water cactus` — due, no stock, single click resolves without
    // firing the lot-picker modal. `takeVitaminD` would open the picker
    // (Hidroferol multi-lot SN) and the direct Done click would deadlock.
    const todaySection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Today' }) })
    const upcomingSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Upcoming' }) })
    const cactusInToday = todaySection.getByTestId('routine-card').filter({ hasText: SEED.routines.waterCactus })
    const cactusInUpcoming = upcomingSection
      .getByTestId('routine-card')
      .filter({ hasText: SEED.routines.waterCactus })

    // Starting state: due routine lives in Today.
    await expect(cactusInToday).toBeVisible()

    // Arm the response wait BEFORE clicking so we never miss it. The mark
    // done POST is online; reloading before it lands would abort the
    // in-flight request and the entry would never persist (flaky).
    const logSaved = page.waitForResponse(
      (r) => /\/routines\/\d+\/log\/$/.test(r.url()) && r.request().method() === 'POST',
    )
    await cactusInToday.getByRole('button', { name: 'Done' }).click()

    // Optimistic: the card disappears from Today immediately (<500 ms).
    // `useLogRoutine` filters the entry out of `['dashboard'].due` in its
    // `optimistic()` helper without waiting on the network.
    await expect(cactusInToday).toHaveCount(0, { timeout: 500 })

    // Online → nothing should have landed in the offline queue.
    await expectPendingBadge(page, { count: 0 })

    // Wait for the server to actually persist the completion, then reload.
    // The backend-computed next_due_at moves the routine to Upcoming —
    // proving the mutation hit the server, not just the optimistic cache.
    await logSaved
    await page.reload()
    await expect(cactusInUpcoming).toBeVisible()
    await expect(cactusInToday).toHaveCount(0)
  })

  test('queue persiste tras reload offline y drena al reconectar', async ({ page, context }) => {
    // Use `SEED.routines.iplHairRemoval` (never started per seed → always
    // due, no stock). `takeVitamins` is consumed by test 1 in this spec
    // and is no longer due when test 2 runs — can't click Done on it.
    const morningStretch = page
      .getByTestId('routine-card')
      .filter({ hasText: SEED.routines.iplHairRemoval })

    await goOffline(page, context)
    await expectOfflineBanner(page, { visible: true })

    await morningStretch.getByRole('button', { name: 'Done' }).click()

    await expectPendingBadge(page, { count: 1 })

    await page.reload()
    // Page reload wipes window-level state (LOCK, SET setter). Re-arm the
    // lock so SW-cached 200s can't flip reachable back to true while we
    // assert the persisted queue.
    await page.evaluate(() => {
      window.__NUDGE_REACHABILITY_LOCK__ = false
      window.__NUDGE_REACHABILITY_SET__?.(false)
      window.__NUDGE_REACHABILITY_LOCK__ = true
    })
    await expectOfflineBanner(page, { visible: true })
    await expectPendingBadge(page, { count: 1 })

    await goOnline(page, context)
    await waitForSyncDrain(page)
    await expectOfflineBanner(page, { visible: false })
  })

  test('rename con 422 del servidor revierte la cache y no encola', async ({ page, context }) => {
    // Rename targets SEED.routines.takeVitaminD (the card is still on
    // the dashboard even after test 1 moved it to Upcoming; clicking
    // the link navigates to the detail regardless of due state).
    const card = page.getByTestId('routine-card').filter({ hasText: SEED.routines.takeVitaminD })
    await card.first().click()
    await expect(page).toHaveURL(/\/routines\/\d+$/)
    // T182: routine-detail "Edit" pencil is a `<button>`, not a `<Link>`.
    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page).toHaveURL(/\/routines\/\d+\/edit$/)

    // Mock PATCH /api/routines/{id}/ with 422 on the context (intercepts
    // SW fetches too). `times: 1` so if the mutation retries we observe
    // the behaviour on the first call only.
    let patchCount = 0
    await context.route('**/api/routines/*/', (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      patchCount += 1
      return route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ name: ['Invalid'] }),
      })
    })

    const nameInput = page.getByPlaceholder(/change water filter/i)
    await nameInput.clear()
    await nameInput.fill('InvalidName')
    await page.getByRole('button', { name: 'Save' }).click()

    // A 422 is an HTTP response, not an OfflineError, so:
    //   · the api client calls setReachable(true) → banner NOT shown.
    //   · useUpdateRoutine's optimistic helper rolls back the cached
    //     routine to its pre-edit value.
    //   · nothing lands in the offline queue (queueable paths only
    //     enqueue on OfflineError, not on HTTP failure).
    await expectPendingBadge(page, { count: 0 })
    await expectOfflineBanner(page, { visible: false })

    // Navigate away and back: the detail page re-reads the cached
    // routine. If rollback worked, the original `SEED.routines.takeVitaminD`
    // name is restored.
    await page.goto('/')
    await expect(page.getByTestId('routine-card').filter({ hasText: SEED.routines.takeVitaminD })).toBeVisible()

    // Exactly one PATCH was attempted — no implicit retries.
    expect(patchCount).toBe(1)
  })

  test('botón + New routine deshabilitado offline', async ({ page, context }) => {
    // Sanity — the dashboard has rendered. The Today section's routine
    // cards are divs (not links), so use the shared `routineCard` helper
    // that targets `data-testid="routine-card"` rather than role=link.
    await expect(routineCard(page, 'takeVitaminD')).toBeVisible()

    await goOffline(page, context)
    await expectOfflineBanner(page, { visible: true })

    // Offline: DashboardPage swaps the <Link> for a disabled <button>
    // carrying the same aria-label. Click attempts must not navigate.
    const newButton = page.getByRole('button').filter({ has: page.locator('svg use[href$="#i-plus"]') })
    await expect(newButton).toBeVisible()
    await expect(newButton).toBeDisabled()

    const urlBefore = page.url()
    await newButton.click({ force: true }).catch(() => {})
    expect(page.url()).toBe(urlBefore)
  })

  // ── REMOVED: "Settings offline: AlertBanner + controles deshabilitados".
  // T181 introduced ``OfflineRouteGuard`` which intercepts ``/settings``
  // before ``SettingsPage`` renders, so the in-page soft-block banner +
  // disabled controls are no longer reachable. The new offline UX
  // (placeholder + locked bottom-nav + toast) is covered by
  // ``offline-detail-hydration.spec.js``.

  // ── REMOVED: "Settings online-only: save falla con estado offline tras perder red mid-click".
  // T181's ``OfflineRouteGuard`` re-renders ``/settings`` to the locked
  // placeholder as soon as ``setReachable(false)`` fires — and the
  // PATCH abort with ``internetdisconnected`` does flip reachability,
  // so the autosave error toast is unmounted with the SettingsPage
  // before it can be asserted. The "online-only mutation that does not
  // queue and surfaces an error toast" contract is still covered at
  // the unit-test level (``useOfflineMutation.test.jsx`` exercises the
  // ``queueable: false`` + ``OfflineError`` branch directly).

  // ── REMOVED: "editar nota de entry offline se encola y drena al reconectar".
  // T181 locks ``/history`` offline behind ``OfflineRouteGuard``: the
  // entry list (and therefore the note-editing affordance) is not
  // reachable while offline. The note-edit-and-queue flow still works
  // when the page is loaded online and the user goes offline mid-edit,
  // but that variant is functionally identical to the other queued
  // mutation tests already in this suite (mark done online ➜ queued
  // offline drain) and would only re-test queue persistence we already
  // assert. Removing without replacement.
})
