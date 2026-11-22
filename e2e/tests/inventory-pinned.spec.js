import { test, expect } from '@playwright/test'
import { SEED } from './helpers/constants.js'
import { loginAsUser1, resetSeed } from './helpers/session.js'
import { goToInventory, goToStockDetail } from './helpers/navigation.js'

/**
 * Pinned products (T095): a per-user shortcut at the top of the inventory.
 *
 * The seed already pins `SEED.pinnedForUser1` (there is no limit),
 * so every test starts from that state, and resets the seed first: a pin
 * survives in the database, and one leaked by a failed test would shift
 * the counts of the next.
 */
test.describe('Pinned products', () => {
  // Not pinned by the seed, so pinning it is the change under test.
  const KEY = 'ebastine'
  const STOCK = SEED.stocks[KEY]
  const SEEDED = SEED.pinnedForUser1.length

  test.beforeEach(async ({ page, context }) => {
    await resetSeed(context)
    await loginAsUser1(page)
    await goToInventory(page, { filter: 'featured' })
    await expect(page.getByTestId('product-card').first()).toBeVisible()
  })

  const featured = (page) => page.getByTestId('inventory-list')

  test('pinning from the detail page adds it to Featured', async ({ page }) => {
    await expect(featured(page).getByTestId('product-card')).toHaveCount(SEEDED)
    await expect(featured(page).getByTestId('product-card').filter({ hasText: STOCK })).toHaveCount(0)

    await goToStockDetail(page, KEY)
    const pin = page.getByTestId('pin-toggle')
    await expect(pin).toHaveAttribute('data-pinned', 'false')
    await pin.click()
    await expect(pin).toHaveAttribute('data-pinned', 'true')

    await goToInventory(page, { filter: 'featured' })
    await expect(featured(page).getByTestId('product-card')).toHaveCount(SEEDED + 1)
    await expect(featured(page).getByTestId('product-card').filter({ hasText: STOCK })).toHaveCount(1)

    await goToStockDetail(page, KEY)
    await page.getByTestId('pin-toggle').click()
    await expect(page.getByTestId('pin-toggle')).toHaveAttribute('data-pinned', 'false')
    await goToInventory(page, { filter: 'featured' })
    await expect(featured(page).getByTestId('product-card')).toHaveCount(SEEDED)
  })

  test('there is no limit on featured products', async ({ page }) => {
    for (const key of ['ebastine', 'paracetamol', 'biodramina']) {
      await goToStockDetail(page, key)
      await page.getByTestId('pin-toggle').click()
      await expect(page.getByTestId('pin-toggle')).toHaveAttribute('data-pinned', 'true')
    }

    await goToInventory(page, { filter: 'featured' })
    await expect(featured(page).getByTestId('product-card')).toHaveCount(SEEDED + 3)
  })
})
