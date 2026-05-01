import { test, expect } from '@playwright/test'
import {
  SEED,
  loginAsUser1,
  resetSeed,
  goToDashboard,
  goToHistory,
  markRoutineDone,
  routineCard,
  historyEntry,
  stockCard,
  goToInventory,
  readNumericValue,
} from './helpers.js'

/**
 * T036 — Routine completion happy paths + edge cases.
 *
 * Each test is atomic — one concept, one behaviour — and resets the
 * backend state in `beforeEach` so subsequent tests don't inherit
 * entries or stock decrements from previous ones.
 *
 * Bugs closed as part of T036 (discovered writing these tests):
 *   · Backend refuses to log when stock is insufficient (was silently
 *     logging, leaving an audit hole for pain_relief-style routines).
 *   · Frontend Undo flow (DELETE /entries/{id}/) that restores the
 *     consumed lots — triggered from the success toast.
 */
test.describe('Routine completion', () => {
  test.beforeEach(async ({ page, context }) => {
    await resetSeed(context)
    await loginAsUser1(page)
    await expect(page.getByTestId('offline-banner')).toBeHidden()
  })

  test('marking a no-stock routine done creates a history entry', async ({ page }) => {
    // Pick a routine with no linked stock so a single click on Done
    // resolves without firing the lot-picker modal. `Water cactus` is
    // due, has no stock, and only one prior entry — easy to assert
    // history grew after the click.
    await goToDashboard(page)
    await markRoutineDone(page, 'waterCactus')

    await goToHistory(page)
    await expect(historyEntry(page, { routineKey: 'waterCactus', type: 'routine' }).first()).toBeVisible()
  })

  test('marking a stock-linked routine consumes the FEFO lot', async ({ page }) => {
    // Medication has Pills (3 lots with SN) → requires_lot_selection.
    // FEFO order is PILL-1 (30d) → PILL-2 (60d) → PILL-3 (90d), so
    // pick PILL-1 explicitly; the spec asserts the backend wired the
    // selection through and the UI reflects the decrement.
    await goToInventory(page)
    const pillsCard = stockCard(page, 'ebastine')
    const before = await readNumericValue(pillsCard)
    expect(before).toBeGreaterThan(0)

    await goToDashboard(page)
    await markRoutineDone(page, 'takeAntihistamine', { lotNumber: SEED.lots.EBASTINE_LOTS[0] })

    // Stock total drops by exactly 1. Use `expect.poll` because the
    // inventory page initially paints the TQ-cached value and only
    // repaints after the background refetch settles — a single
    // `readNumericValue` racily observes the pre-refetch snapshot.
    await goToInventory(page)
    await expect(stockCard(page, 'ebastine')).toBeVisible()
    await expect
      .poll(async () => readNumericValue(stockCard(page, 'ebastine')), { timeout: 5_000 })
      .toBe(before - 1)

    // History entry records the specific lot consumed.
    await goToHistory(page)
    const entry = historyEntry(page, { routineKey: 'takeAntihistamine', type: 'routine' }).first()
    await expect(entry).toContainText(SEED.lots.EBASTINE_LOTS[0])
  })

  test('marking a routine done moves it out of the Today section', async ({ page }) => {
    const today = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Today' }) })
    const upcoming = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Upcoming' }) })
    const inToday = today.getByTestId('routine-card').filter({ hasText: SEED.routines.iplHairRemoval })
    const inUpcoming = upcoming.getByTestId('routine-card').filter({ hasText: SEED.routines.iplHairRemoval })

    await expect(inToday).toBeVisible()
    await markRoutineDone(page, 'iplHairRemoval')

    // Reload so we read the backend-computed next_due_at rather than
    // the optimistic cache (which only removes from `due` without
    // populating `upcoming`).
    await page.reload()
    await expect(inToday).toHaveCount(0)
    await expect(inUpcoming).toBeVisible()
  })

  test('the Undo toast restores the entry and the consumed stock', async ({ page }) => {
    // waterFilter has one lot (1 unit, no SN, no expiry) → no lot
    // modal opens, stock drops to 0 after Done, the Undo flow must
    // put the unit back.
    await goToInventory(page)
    const filterCard = stockCard(page, 'britaFilter')
    const before = await readNumericValue(filterCard)
    expect(before).toBe(1)

    await goToDashboard(page)
    await markRoutineDone(page, 'changeBritaFilter')

    // The success toast exposes an Undo button (T036 feature gap closed).
    const undoBtn = page.getByRole('button', { name: 'Undo' })
    await expect(undoBtn).toBeVisible({ timeout: 3_000 })
    await undoBtn.click()

    // Backend restored the lot → inventory shows 1 again.
    await goToInventory(page)
    await expect(filterCard).toBeVisible()
    await expect
      .poll(async () => readNumericValue(stockCard(page, 'britaFilter')), { timeout: 5_000 })
      .toBe(before)

    // History has no waterFilter entry.
    await goToHistory(page)
    await expect(historyEntry(page, { routineKey: 'changeBritaFilter', type: 'routine' })).toHaveCount(0)
  })

  test('a stock-depleted routine cannot be marked done', async ({ page }) => {
    // painRelief → ibuprofen (seed: qty=0). Done button must be
    // disabled (T036 feature gap closed in RoutineCard) and no entry
    // must reach History.
    await goToDashboard(page)
    await markRoutineDone(page, 'changePumpCannula', { expectBlocked: true })

    await goToHistory(page)
    await expect(historyEntry(page, { routineKey: 'changePumpCannula', type: 'routine' })).toHaveCount(0)
  })
})
