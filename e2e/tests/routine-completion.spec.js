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
    await goToDashboard(page)
    await markRoutineDone(page, 'takeVitamins')

    await goToHistory(page)
    // A Take vitamins entry is now on the History page. The seed has
    // older entries too, but this spec only asserts that at least one
    // appears after the mark-done (mutation succeeded) — more detailed
    // timestamp asserts are out of scope here.
    await expect(historyEntry(page, { routineKey: 'takeVitamins', type: 'routine' }).first()).toBeVisible()
  })

  test('marking a stock-linked routine consumes the FEFO lot', async ({ page }) => {
    // Medication has Pills (3 lots with SN) → requires_lot_selection.
    // FEFO order is PILL-1 (30d) → PILL-2 (60d) → PILL-3 (90d), so
    // pick PILL-1 explicitly; the spec asserts the backend wired the
    // selection through and the UI reflects the decrement.
    await goToInventory(page)
    const pillsCard = stockCard(page, 'pills')
    const before = await readNumericValue(pillsCard)
    expect(before).toBeGreaterThan(0)

    await goToDashboard(page)
    await markRoutineDone(page, 'medication', { lotNumber: SEED.lots.PILLS[0] })

    // Stock total drops by exactly 1. Use `expect.poll` because the
    // inventory page initially paints the TQ-cached value and only
    // repaints after the background refetch settles — a single
    // `readNumericValue` racily observes the pre-refetch snapshot.
    await goToInventory(page)
    await expect(stockCard(page, 'pills')).toBeVisible()
    await expect
      .poll(async () => readNumericValue(stockCard(page, 'pills')), { timeout: 5_000 })
      .toBe(before - 1)

    // History entry records the specific lot consumed.
    await goToHistory(page)
    const entry = historyEntry(page, { routineKey: 'medication', type: 'routine' }).first()
    await expect(entry).toContainText(SEED.lots.PILLS[0])
  })

  test('marking a routine done moves it out of the Today section', async ({ page }) => {
    const today = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Today' }) })
    const upcoming = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Upcoming' }) })
    const inToday = today.getByTestId('routine-card').filter({ hasText: SEED.routines.morningStretch })
    const inUpcoming = upcoming.getByTestId('routine-card').filter({ hasText: SEED.routines.morningStretch })

    await expect(inToday).toBeVisible()
    await markRoutineDone(page, 'morningStretch')

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
    const filterCard = stockCard(page, 'filterCartridge')
    const before = await readNumericValue(filterCard)
    expect(before).toBe(1)

    await goToDashboard(page)
    await markRoutineDone(page, 'waterFilter')

    // The success toast exposes an Undo button (T036 feature gap closed).
    const undoBtn = page.getByRole('button', { name: 'Undo' })
    await expect(undoBtn).toBeVisible({ timeout: 3_000 })
    await undoBtn.click()

    // Backend restored the lot → inventory shows 1 again.
    await goToInventory(page)
    await expect(filterCard).toBeVisible()
    await expect
      .poll(async () => readNumericValue(stockCard(page, 'filterCartridge')), { timeout: 5_000 })
      .toBe(before)

    // History has no waterFilter entry.
    await goToHistory(page)
    await expect(historyEntry(page, { routineKey: 'waterFilter', type: 'routine' })).toHaveCount(0)
  })

  test('a stock-depleted routine cannot be marked done', async ({ page }) => {
    // painRelief → ibuprofen (seed: qty=0). Done button must be
    // disabled (T036 feature gap closed in RoutineCard) and no entry
    // must reach History.
    await goToDashboard(page)
    await markRoutineDone(page, 'painRelief', { expectBlocked: true })

    await goToHistory(page)
    await expect(historyEntry(page, { routineKey: 'painRelief', type: 'routine' })).toHaveCount(0)
  })
})
