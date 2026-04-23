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
    await shareRoutineWith(page, routineName, SEED.user2.username)

    // Separate context for user2 — lean and fast (no logout/login cycle).
    const ctx2 = await browser.newContext()
    const page2 = await ctx2.newPage()
    try {
      await loginAsUser2(page2)
      await expect(routineCard(page2, routineName)).toBeVisible()

      // user1 unshares by toggling user2 off in the routine form.
      await unshareRoutineFrom(page, routineName, SEED.user2.username)

      // user2 should no longer see the routine after a fresh fetch. The
      // TanStack Query persister keeps a 30s stale window, so a plain
      // reload would re-render the cached (still-shared) state. Drop the
      // persisted cache before the reload to force a fresh GET.
      await forceRefetchOnReload(page2)
      await expect(routineCard(page2, routineName)).toHaveCount(0)
    } finally {
      await ctx2.close()
    }
  })

  test('unsharing a stock removes it from the recipient inventory', async ({ browser, page }) => {
    await loginAsUser1(page)

    const stockName = uniqueName('e2e-unshare-stock')
    await createStock(page, { name: stockName })
    // createStock leaves the page on inventory; share from the card.
    await shareStockWith(page, stockName, SEED.user2.username)

    const ctx2 = await browser.newContext()
    const page2 = await ctx2.newPage()
    try {
      await loginAsUser2(page2)
      await goToInventory(page2)
      await expect(stockCard(page2, stockName)).toBeVisible()

      // Unshare: toggle user2 off via the stock detail → edit form.
      await shareStockWith(page, stockName, SEED.user2.username)

      // Same persister caveat as the routine test — clear before reload.
      await forceRefetchOnReload(page2)
      await expect(stockCard(page2, stockName)).toHaveCount(0)
    } finally {
      await ctx2.close()
    }
  })
})

// Drop the TanStack Query IDB persister so the next reload refetches
// every query from the server regardless of its staleTime.
async function forceRefetchOnReload(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('nudge-query-cache')
        req.onsuccess = resolve
        req.onerror = resolve
        req.onblocked = resolve
      }),
  )
  await page.reload()
}
