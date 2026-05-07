import { test, expect } from '@playwright/test'
import {
  SEED,
  expectOfflineBanner,
  goOffline,
  goOnline,
  loginAsUser1,
  resetSeed,
  routineCard,
} from './helpers.js'

/**
 * T183 — End-to-end coverage for the offline UX overhaul (T178–T182).
 *
 * Walks the integrated user journey instead of the per-component mocks
 * each unit test exercises:
 *   1. Detail page hydrates from the dashboard list cache when the user
 *      navigates offline.
 *   2. The OfflineBanner shows the "last sync" timestamp on its second line.
 *   3. The bottom nav greys out /history and /settings while offline; a
 *      click on either dispatches the toast instead of navigating.
 *   4. Direct navigation to a locked URL while offline shows the placeholder.
 *
 * Runs only under the `chromium-preview` project per playwright.config.js
 * (testMatch /offline-.*\.spec\.js/) — the production-like SW precache is
 * required for the offline reads to work end-to-end.
 */
test.describe('Offline detail hydration + locked routes', () => {
  test.beforeEach(async ({ context }) => {
    await resetSeed(context)
  })

  test('routine detail renders offline when the routine is in the dashboard cache', async ({ page, context }) => {
    await loginAsUser1(page)
    // Wait for the dashboard cache to be populated by the initial fetch.
    await expect(page.getByTestId('routine-card').first()).toBeVisible()

    // Pick a routine we know exists in the seed and capture its name.
    const card = routineCard(page, 'changeBritaFilter').first()
    await expect(card).toBeVisible()
    const routineName = SEED.routines.changeBritaFilter

    await goOffline(page, context)
    await expectOfflineBanner(page, { visible: true })

    // Click the card → navigate to the detail page. With the seeded
    // initialData (T179), the page should render immediately from cache
    // even though the detail endpoint is unreachable.
    await card.click()

    // The page heading shows the routine name. If hydration failed, the
    // QueryHandler "Could not load data" branch would render instead.
    await expect(page.getByRole('heading', { level: 1, name: routineName })).toBeVisible()
    await expect(page.getByText(/could not load data/i)).toHaveCount(0)
  })

  test('offline banner shows the "last sync" timestamp once the page has been online', async ({ page, context }) => {
    await loginAsUser1(page)
    // A successful api response stamps lastReachableAt before we go
    // offline — the dashboard fetch is the obvious candidate.
    await page.waitForResponse(
      (res) => res.url().includes('/api/dashboard/') && res.ok(),
      { timeout: 10_000 },
    )

    await goOffline(page, context)
    const banner = page.getByTestId('offline-banner')
    await expect(banner).toBeVisible()
    // The default seed user (cibran) is en/es/gl-tolerant; match either
    // wording so the test stays useful regardless of the active locale.
    await expect(banner).toContainText(/last sync|última sincronización/i)
  })

  test('bottom nav disables /history offline; click triggers a toast and does not navigate', async ({
    page,
    context,
  }) => {
    await loginAsUser1(page)
    await expect(page.getByTestId('routine-card').first()).toBeVisible()

    await goOffline(page, context)

    // Locked items render as <button aria-disabled="true"> instead of <a>.
    // exact: true because the push-alert banner button text "Notifications
    // are off — enable them in settings" also matches partial /settings/i;
    // we apply the same exact match to History for symmetry.
    const historyButton = page.getByRole('button', { name: 'History', exact: true })
    await expect(historyButton).toHaveAttribute('aria-disabled', 'true')

    const urlBefore = page.url()
    // force: true bypasses Playwright's auto-wait for "enabled" state —
    // an aria-disabled button is treated as not-enabled but its native
    // onClick handler still fires, which is exactly the behaviour we want.
    await historyButton.click({ force: true })
    expect(page.url()).toBe(urlBefore)
    // Toast surfaces the offline.pageUnavailable copy.
    await expect(
      page.getByText(/not available offline|no está disponible sin conexión|non está dispoñible/i),
    ).toBeVisible()
  })

  test('bottom nav disables /settings offline (parallel to /history)', async ({ page, context }) => {
    await loginAsUser1(page)
    await expect(page.getByTestId('routine-card').first()).toBeVisible()

    await goOffline(page, context)

    const settingsButton = page.getByRole('button', { name: 'Settings', exact: true })
    await expect(settingsButton).toHaveAttribute('aria-disabled', 'true')

    const urlBefore = page.url()
    await settingsButton.click({ force: true })
    expect(page.url()).toBe(urlBefore)
  })

  test('OfflineRouteGuard swaps /history for the locked placeholder when reachability flips', async ({
    page,
    context,
  }) => {
    // Variant of the deep-link scenario that exercises the guard's
    // subscription path: arrive at /history while online, then flip
    // offline. The route guard re-renders the subtree and replaces
    // <HistoryPage> with <OfflineLockedPlaceholder>. Operationally
    // equivalent to a deep-link from the user's POV (URL unchanged,
    // placeholder shown). Avoids the page.goto-while-setOffline issue
    // (Chromium aborts hard navigations even when the SW could serve).
    await loginAsUser1(page)
    await expect(page.getByTestId('routine-card').first()).toBeVisible()

    // Online navigation to history.
    await page.getByRole('link', { name: 'History', exact: true }).click()
    await expect(page).toHaveURL(/\/history$/)

    // Flip offline — guard kicks in.
    await goOffline(page, context)
    await expect(page.getByTestId('offline-locked-placeholder')).toBeVisible()

    // "Back home" CTA navigates to /.
    await page.getByRole('button', { name: /back home|volver al inicio|volver ao inicio/i }).click()
    await expect(page).toHaveURL(/\/$/)
  })
})
