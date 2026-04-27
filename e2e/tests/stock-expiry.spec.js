import { test, expect } from '@playwright/test'
import {
  SEED,
  loginAsUser1,
  resetSeed,
  goToInventory,
  goToStockDetail,
  goToHistory,
  stockCard,
  historyEntry,
  addLot,
  formatExpiryDate,
  expectLotCount,
  uniqueName,
} from './helpers.js'

/**
 * T037 — Stock expiry indicator + FIFO consumption + lot dedup.
 *
 * Each test is atomic and starts from a fresh seed via `resetSeed` so
 * the dedup scenarios don't inherit mutations from each other.
 *
 * The `data-expiring` attribute on `[data-testid="lot-row"]`
 * (StockDetailPage) is the assertable signal for the expiry
 * indicator. As of T106 it is tri-state:
 *   - `'reached'` → the lot's `expiry_date <= today` (already expired)
 *   - `'soon'`    → `today < expiry_date < today + 30 days`
 *   - `'none'`    → either no expiry_date, or it falls outside the
 *                   30-day window
 * Using data attributes keeps the test independent from the design
 * system's CSS class hashes.
 */
test.describe('Stock expiry and dedup', () => {
  test.beforeEach(async ({ page, context }) => {
    await resetSeed(context)
    await loginAsUser1(page)
    await goToInventory(page)
    await expect(page.getByTestId('offline-banner')).toBeHidden()
  })

  test('near-expiry lot is flagged on the Vitamin D detail page', async ({ page }) => {
    // Lot rows live on the stock detail page (the inventory card only shows
    // the aggregate quantity + optional alert banner).
    await goToStockDetail(page, 'vitaminD')

    // VIT-A expires in 7 days → 'soon'. VIT-B expires in 180 days → 'none'.
    const vitaRow = page.getByTestId('lot-row').filter({ hasText: SEED.lots.VITAMIN_D_NEAR_EXPIRY })
    await expect(vitaRow).toHaveAttribute('data-expiring', 'soon')

    const vitbRow = page.getByTestId('lot-row').filter({ hasText: SEED.lots.VITAMIN_D_FAR })
    await expect(vitbRow).toHaveAttribute('data-expiring', 'none')
  })

  test('lot without expiry_date is not flagged', async ({ page }) => {
    // Filter cartridge has one lot with no SN and no expiry — nothing
    // to expire, nothing to flag.
    await goToStockDetail(page, 'filterCartridge')
    const row = page.getByTestId('lot-row').first()
    await expect(row).toHaveAttribute('data-expiring', 'none')
  })

  test('Consume chooses VIT-A by FEFO (nearest expiry)', async ({ page }) => {
    // Clicking Consume on a stock card opens the LotPickerModal. The modal's
    // radio list is pre-sorted FEFO and pre-selects the first option, which
    // must be VIT-A (7 days) — not VIT-B (180 days) nor the no-SN lot.
    const card = stockCard(page, 'vitaminD')
    await card.getByRole('button', { name: 'Consume 1 unit' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const firstRadio = dialog.getByRole('radio').first()
    await expect(firstRadio).toContainText(SEED.lots.VITAMIN_D_NEAR_EXPIRY)

    // Confirm the pre-selection (VIT-A). LotPickerModal labels the
    // confirm button "Consume 1" (quantity is always 1 from the card).
    await dialog.getByRole('button', { name: 'Consume 1', exact: true }).click()
    await expect(dialog).toBeHidden()

    // Backend records a StockConsumption referencing VIT-A; Stock-detail
    // shows the lot row dropped from 5 → 4.
    await goToStockDetail(page, 'vitaminD')
    const vitaRow = page.getByTestId('lot-row').filter({ hasText: SEED.lots.VITAMIN_D_NEAR_EXPIRY })
    await expect(vitaRow).toContainText(/4\s*u\./)
    // VIT-B (30 u) is untouched — proves the consumption obeyed FEFO.
    const vitbRow = page.getByTestId('lot-row').filter({ hasText: SEED.lots.VITAMIN_D_FAR })
    await expect(vitbRow).toContainText(/30\s*u\./)

    // History confirms the specific lot that was debited.
    await goToHistory(page)
    await page.getByLabel('Type', { exact: true }).selectOption({ label: 'Stock' })
    await expect(historyEntry(page, { stockKey: 'vitaminD', type: 'consumption' }).first()).toContainText(
      SEED.lots.VITAMIN_D_NEAR_EXPIRY,
    )
  })

  test('adding a lot with matching lot_number + expiry_date merges', async ({ page }) => {
    // Seed: VIT-A = 5 u at today + 7d. Adding 3 more with exactly the
    // same SN and expiry must bump VIT-A to 8 without spawning a new
    // lot row.
    await addLot(page, 'vitaminD', {
      quantity: 3,
      expiryDate: formatExpiryDate(7),
      lotNumber: SEED.lots.VITAMIN_D_NEAR_EXPIRY,
    })

    await expectLotCount(page, 'vitaminD', 3)
    const vitaRow = page.getByTestId('lot-row').filter({ hasText: SEED.lots.VITAMIN_D_NEAR_EXPIRY })
    await expect(vitaRow).toContainText(/8\s*u\./)
  })

  test('adding a no-SN lot with matching expiry_date merges', async ({ page }) => {
    // Seed: one lot without SN, 20 u at today + 60d. Same expiry + no
    // SN must merge (the dedup lookup matches on stock + empty SN +
    // expiry, per backend views.py:217).
    await addLot(page, 'vitaminD', {
      quantity: 5,
      expiryDate: formatExpiryDate(SEED.lots.VITAMIN_D_NO_SN_EXPIRY_DAYS),
      lotNumber: '',
    })

    await expectLotCount(page, 'vitaminD', 3)
    // The row for the merged lot has no SN — locate it by its expiry
    // text (formatted by formatExpiry) and read the qty.
    const rows = page.getByTestId('lot-row')
    // Exactly one row should show 25 u (the merged no-SN lot).
    await expect(rows.filter({ hasText: /25\s*u\./ })).toHaveCount(1)
  })

  test('adding a lot with different SN or expiry creates a new row', async ({ page }) => {
    // Case A: brand-new SN + brand-new expiry → new lot.
    const newSn = uniqueName('VIT-NEW')
    await addLot(page, 'vitaminD', {
      quantity: 10,
      expiryDate: formatExpiryDate(30),
      lotNumber: newSn,
    })
    await expectLotCount(page, 'vitaminD', 4)

    // Case B: same SN as VIT-A but different expiry → still new.
    // (Backend dedup matches on (SN + expiry) — both must be equal.)
    await addLot(page, 'vitaminD', {
      quantity: 2,
      expiryDate: formatExpiryDate(14),
      lotNumber: SEED.lots.VITAMIN_D_NEAR_EXPIRY,
    })
    await expectLotCount(page, 'vitaminD', 5)

    // Two distinct VIT-A rows now coexist (different expiries).
    const vitaRows = page.getByTestId('lot-row').filter({ hasText: SEED.lots.VITAMIN_D_NEAR_EXPIRY })
    await expect(vitaRows).toHaveCount(2)
  })
})
