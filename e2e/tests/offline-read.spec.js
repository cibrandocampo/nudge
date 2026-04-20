import { test, expect } from '@playwright/test'
import {
  SEED,
  freshSession,
  goOffline,
  goOnline,
  goToDashboard,
  goToInventory,
  waitForServiceWorkerReady,
  expectOfflineBanner,
  mockApiRoute,
  routineCard,
  stockCard,
} from './helpers.js'

/**
 * T069 — Offline read + reachability + cache warm.
 *
 * Four atomic tests, each a single assertion about the offline-read
 * side of the PWA. Mutation / sync flows live in T070 / T071.
 */
test.describe('offline-read', () => {
  test.beforeEach(async ({ page, context }) => {
    await freshSession(page, context, { loginAs: 'user1' })
    await waitForServiceWorkerReady(page)
    // The dashboard must render fully before we go offline — otherwise the
    // reload test below cannot fall back to a warm TQ cache.
    await expect(routineCard(page, 'takeVitamins')).toBeVisible()
  })

  test('dashboard reload offline mantiene la vista desde caché', async ({ page, context }) => {
    await goOffline(page, context)
    await expectOfflineBanner(page, { visible: true })

    await page.reload()

    // After reload with no network, TQ persister + SW runtime cache must
    // re-render the dashboard. Any redirect to /login indicates AuthContext
    // evicted the user because /auth/me/ failed (offline-hardening regression).
    await expect(page).toHaveURL('/')
    await expect(routineCard(page, 'takeVitamins')).toBeVisible()
    await expectOfflineBanner(page, { visible: true })
  })

  test('reload offline sin red no expulsa al login (AuthContext hidratación)', async ({ page, context }) => {
    // Simulate closing the tab, then reopening with no network: navigate
    // away first so the in-memory TQ state is released, then flip offline,
    // then navigate back to `/`.
    await page.goto('about:blank')
    await goOffline(page, context)
    await page.goto('/')

    await expect(page).toHaveURL('/')
    await expect(routineCard(page, 'takeVitamins')).toBeVisible()
    await expectOfflineBanner(page, { visible: true })
  })

  test('backend unreachable dispara OfflineBanner sin cambiar navigator.onLine', async ({ page, context }) => {
    // Simulate "backend process down, WiFi fine" (ECONNREFUSED). Two
    // pieces are needed together:
    //   1. `context.route` so browser-level fetches reject even when
    //      the Service Worker makes them (page.route does not intercept
    //      SW-originated requests).
    //   2. Wipe every Cache-API bucket — the SW's NetworkFirst strategy
    //      falls back to cached 200s when fetch rejects, and the api
    //      client would then observe "success" and keep reachable=true.
    // This matches the real-world failure mode where the backend is
    // down and the SW has stale cache: the app should still surface
    // the banner so the user knows their mutations won't sync.
    await page.evaluate(() => {
      window.__NUDGE_REACHABILITY_POLL_MS__ = 500
    })
    await page.evaluate(async () => {
      for (const name of await caches.keys()) await caches.delete(name)
    })
    // Narrow to an absolute-URL pattern so the abort does NOT also hit
    // `/src/api/client.js` (Vite dev serves React modules from /src/api/*
    // and `**/api/**` matches those as well). Hitting those makes the
    // reload render a blank page because React never mounts.
    const pattern = /^https?:\/\/[^/]+\/api\//
    const abortHandler = (route) => route.abort('connectionrefused')
    await context.route(pattern, abortHandler)

    await page.reload()
    await expectOfflineBanner(page, { visible: true })
    expect(await page.evaluate(() => navigator.onLine)).toBe(true)

    await context.unroute(pattern, abortHandler)
    await page.evaluate(() => {
      window.__NUDGE_REACHABILITY_LOCK__ = false
      if (typeof window.__NUDGE_REACHABILITY_SET__ === 'function') {
        window.__NUDGE_REACHABILITY_SET__(true)
      }
    })
    await expectOfflineBanner(page, { visible: false })
  })

  test('warm de stock permite seleccionar lote offline sin /lots-for-selection', async ({ page, context }) => {
    // Warm: visiting /inventory populates the ['stock'] TQ cache with
    // each stock's lots (incl. Pills' PILL-1/2/3 from the seed).
    await goToInventory(page)
    await expect(stockCard(page, 'pills')).toBeVisible()

    await goToDashboard(page)

    // Any /lots-for-selection/ call while offline would have to come from
    // the old direct api.get path — fail the test loudly if one leaks.
    const lotsForSelectionRequests = []
    page.on('request', (req) => {
      if (req.url().includes('/lots-for-selection/')) lotsForSelectionRequests.push(req.url())
    })

    await goOffline(page, context)
    await expectOfflineBanner(page, { visible: true })

    // Medication has Pills with 3 lots (PILL-1/2/3) with SNs and qty > 0
    // → `requires_lot_selection` is true → the lot-selection modal opens.
    await routineCard(page, 'medication').getByRole('button', { name: 'Done' }).click()

    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible()
    for (const lotNumber of SEED.lots.PILLS) {
      await expect(modal.getByText(lotNumber)).toBeVisible()
    }

    expect(lotsForSelectionRequests).toEqual([])

    // Close the modal so the test doesn't leak an open overlay.
    await page.keyboard.press('Escape')
    await goOnline(page, context)
  })
})
