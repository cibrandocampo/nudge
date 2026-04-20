import { test, expect } from '@playwright/test'
import {
  SEED,
  freshSession,
  goOffline,
  goOnline,
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
    await freshSession(page, context, { loginAs: 'user1' })
    await waitForServiceWorkerReady(page)
    await expect(routineCard(page, 'takeVitamins')).toBeVisible()
  })

  test('mark done online: optimistic removal del Today + persistencia tras reload', async ({ page }) => {
    const todaySection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Today' }) })
    const upcomingSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Upcoming' }) })
    const takeVitaminsInToday = todaySection.getByTestId('routine-card').filter({ hasText: SEED.routines.takeVitamins })
    const takeVitaminsInUpcoming = upcomingSection
      .getByTestId('routine-card')
      .filter({ hasText: SEED.routines.takeVitamins })

    // Starting state: overdue routine lives in Today.
    await expect(takeVitaminsInToday).toBeVisible()

    await takeVitaminsInToday.getByRole('button', { name: 'Done' }).click()

    // Optimistic: the card disappears from Today immediately (<500 ms).
    // `useLogRoutine` filters the entry out of `['dashboard'].due` in its
    // `optimistic()` helper without waiting on the network.
    await expect(takeVitaminsInToday).toHaveCount(0, { timeout: 500 })

    // Online → nothing should have landed in the offline queue.
    await expectPendingBadge(page, { count: 0 })

    // After reload the backend-computed next_due_at moves the routine
    // to the Upcoming section; that proves the mutation actually hit
    // the server (not just the optimistic cache).
    await page.reload()
    await expect(takeVitaminsInUpcoming).toBeVisible()
    await expect(takeVitaminsInToday).toHaveCount(0)
  })

  test('queue persiste tras reload offline y drena al reconectar', async ({ page, context }) => {
    // Use `SEED.routines.morningStretch` (never started per seed → always
    // due, no stock). `takeVitamins` is consumed by test 1 in this spec
    // and is no longer due when test 2 runs — can't click Done on it.
    const morningStretch = page
      .getByTestId('routine-card')
      .filter({ hasText: SEED.routines.morningStretch })

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
    // Rename targets SEED.routines.takeVitamins (the card is still on
    // the dashboard even after test 1 moved it to Upcoming; clicking
    // the link navigates to the detail regardless of due state).
    const card = page.getByTestId('routine-card').filter({ hasText: SEED.routines.takeVitamins })
    await card.first().click()
    await expect(page).toHaveURL(/\/routines\/\d+$/)
    await page.getByRole('link', { name: 'Edit' }).click()
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
    // routine. If rollback worked, the original `SEED.routines.takeVitamins`
    // name is restored.
    await page.goto('/')
    await expect(page.getByTestId('routine-card').filter({ hasText: SEED.routines.takeVitamins })).toBeVisible()

    // Exactly one PATCH was attempted — no implicit retries.
    expect(patchCount).toBe(1)
  })

  test('botón + New routine deshabilitado offline', async ({ page, context }) => {
    const newLink = page.getByRole('link', { name: SEED.routines.takeVitamins }) // sanity — dashboard loaded

    await expect(newLink).toBeVisible()

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

  test('Settings offline: AlertBanner + controles deshabilitados', async ({ page, context }) => {
    await goOffline(page, context)
    await page.goto('/settings')

    // Soft-block banner on the Settings page itself.
    await expect(page.getByText('Settings require a connection to the server.')).toBeVisible()

    // Timezone Combobox — disabled input prevents opening the listbox.
    await expect(page.getByPlaceholder('Search timezone…')).toBeDisabled()

    // Language buttons — rendered with the full native name, not the code.
    for (const label of ['English', 'Español', 'Galego']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled()
    }

    // Save changes button.
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled()

    // Daily time input (type=time) — read-only offline so the user cannot
    // queue an unsendable change from the form.
    await expect(page.locator('input[type="time"]').first()).toBeDisabled()
  })

  test('Settings online-only: save falla con estado offline tras perder red mid-click', async ({ page, context }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    // Intercept ONLY the PATCH to /auth/me/. Use `context.route` so the
    // abort reaches even when the SW handles the fetch.
    await context.route('**/api/auth/me/', (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      return route.abort('internetdisconnected')
    })

    const timeInput = page.locator('input[type="time"]').first()
    await timeInput.fill('07:30')
    await page.getByRole('button', { name: 'Save changes' }).click()

    // useUpdateMe is `queueable: false`, so on OfflineError it does NOT
    // enqueue — it surfaces the failure. SettingsPage catches it and
    // flips `saveStatus='offline'` which swaps the submit button's
    // label to `t('offline.actionUnavailable')`.
    await expect(page.getByRole('button', { name: 'Action not available offline' })).toBeVisible()
    await expectPendingBadge(page, { count: 0 })
  })

  test('editar nota de entry offline se encola y drena al reconectar', async ({ page, context }) => {
    await page.goto('/history')

    // Seed's Medication entries carry the note "morning dose" every 3rd
    // entry. Pick the first one — the spec doesn't care which, only
    // that its edited value persists after sync.
    const noteButton = page.getByRole('button', { name: 'morning dose' }).first()
    await expect(noteButton).toBeVisible()

    await goOffline(page, context)

    await noteButton.click()
    // EntryCard autofocuses a single `input[class*="notesInput"]` — use
    // that; `fill` replaces the defaultValue, `press('Enter')` triggers
    // onSave via the onKeyDown handler.
    const input = page.locator('input[class*="notesInput"]').first()
    await input.fill('edited offline')
    await input.press('Enter')

    await expect(page.getByRole('button', { name: 'edited offline' }).first()).toBeVisible()
    await expectPendingBadge(page, { count: 1 })

    await goOnline(page, context)
    await waitForSyncDrain(page)

    await page.reload()
    await expect(page.getByRole('button', { name: 'edited offline' }).first()).toBeVisible()
  })
})
