import { test, expect } from '@playwright/test'
import {
  SEED,
  loginAsUser1,
  loginAsUser2,
  resetSeed,
  goToDashboard,
  goToInventory,
  createRoutine,
  createStock,
  shareRoutineWith,
  unshareRoutineFrom,
  shareStockWith,
  routineCard,
  stockCard,
  uniqueName,
} from './helpers.js'

/**
 * T039 — Unshare revokes access on the recipient side.
 *
 * Two concepts, two tests:
 *   · a routine stops appearing on the recipient's dashboard after
 *     the owner toggles them off in the share popover.
 *   · a stock item stops appearing in the recipient's inventory after
 *     the same toggle on the stock card.
 *
 * Each test uses a second browser context so the two user sessions
 * are independent — no logout/login ping-pong. The data is created
 * ad hoc (names with `uniqueName(...)`) so the seed's pre-shared
 * items (Medication, Pills) remain untouched for sharing.spec.js.
 */
test.describe('Unshare revokes access', () => {
  test.beforeEach(async ({ context }) => {
    await resetSeed(context)
  })

  test('unsharing a routine removes it from the recipient dashboard', async ({ browser, page }) => {
    await loginAsUser1(page)

    // Create a throwaway routine, then share with user2 from the form.
    // The form defaults to 24h so we skip the interval step entirely.
    const routineName = uniqueName('e2e-unshare-routine')
    await createRoutine(page, { name: routineName })
    await goToDashboard(page)
    await expect(routineCard(page, routineName)).toBeVisible()
    await shareRoutineWith(page, routineName, SEED.user2.name)

    // Separate context for user2 — lean and fast (no logout/login cycle).
    const ctx2 = await browser.newContext()
    const page2 = await ctx2.newPage()
    try {
      await loginAsUser2(page2)
      // Cross-context propagation (user1 shares → fresh user2 context loads
      // its dashboard) plus render can exceed the 5 s default under
      // full-suite backend load; give these convergence checks a wider
      // window. The behaviour is correct — only the timing is variable.
      await expect(routineCard(page2, routineName)).toBeVisible({ timeout: 15_000 })

      // user1 unshares by toggling user2 off in the routine form.
      await unshareRoutineFrom(page, routineName, SEED.user2.name)

      // user2 should no longer see the routine after a fresh fetch. See
      // expectGoneAfterRefetch for why a single reload can be served a
      // stale (still-shared) snapshot and must be retried.
      await expectGoneAfterRefetch(page2, routineCard(page2, routineName))
    } finally {
      await ctx2.close()
    }
  })

  test('unsharing a stock removes it from the recipient inventory', async ({ browser, page }) => {
    await loginAsUser1(page)

    const stockName = uniqueName('e2e-unshare-stock')
    await createStock(page, { name: stockName })
    // createStock leaves the page on inventory; share from the card.
    await shareStockWith(page, stockName, SEED.user2.name)

    const ctx2 = await browser.newContext()
    const page2 = await ctx2.newPage()
    try {
      await loginAsUser2(page2)
      await goToInventory(page2)
      // Wider window for cross-context convergence under full-suite load
      // (see the routine test above).
      await expect(stockCard(page2, stockName)).toBeVisible({ timeout: 15_000 })

      // Unshare: toggle user2 off via the stock detail → edit form.
      await shareStockWith(page, stockName, SEED.user2.name)

      // Same stale-snapshot caveat as the routine test — retry the refetch.
      await expectGoneAfterRefetch(page2, stockCard(page2, stockName))
    } finally {
      await ctx2.close()
    }
  })
})

// Reload the recipient's view from a fully cold cache and assert the named
// item is gone.
//
// The unshare commits server-side before this runs (the Save in
// `unshareRoutineFrom` awaits the PATCH), so a direct API read already shows
// the item revoked. The card lingered for two reasons that compound:
//
//   1. TanStack Query persists its cache via idb-keyval, whose IndexedDB
//      database is named `keyval-store` (`nudge-query-cache` is only the KEY
//      inside it — see frontend/src/query/queryClient.js). The previous helper
//      deleted a database literally named `nudge-query-cache`, which does not
//      exist, so the persister was never actually cleared. On reload React
//      Query rehydrated the still-shared snapshot, and with `staleTime: 30s`
//      it considered that snapshot fresh and did NOT refetch — so the card
//      stayed for the whole stale window regardless of the (correct) server
//      state. The old test only passed when the persister's debounced write
//      hadn't yet captured the shared snapshot.
//   2. The Service Worker caches /api GETs NetworkFirst with a 4s network
//      timeout; a slow post-unshare GET could be served the stale cached list.
//
// So we wipe every IndexedDB database (the real persister store included,
// mirroring freshSession) AND the SW's `nudge-api-cache`, forcing a fully
// fresh fetch on reload. `networkidle` guarantees that fetch finished before
// we assert, ruling out a transient "still loading, list empty" false
// positive. `toPass` retries only to absorb rare cross-context propagation lag.
async function expectGoneAfterRefetch(page, locator) {
  await expect(async () => {
    await page.evaluate(async () => {
      if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
        const dbs = await indexedDB.databases()
        await Promise.all(
          dbs.map(
            (db) =>
              db.name &&
              new Promise((resolve) => {
                const req = indexedDB.deleteDatabase(db.name)
                req.onsuccess = resolve
                req.onerror = resolve
                req.onblocked = resolve
              }),
          ),
        )
      }
      if (typeof caches !== 'undefined') await caches.delete('nudge-api-cache')
    })
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(locator).toHaveCount(0, { timeout: 1_000 })
  }).toPass({ timeout: 25_000, intervals: [1_000, 2_000] })
}
