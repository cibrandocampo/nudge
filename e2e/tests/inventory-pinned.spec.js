import { test, expect } from '@playwright/test'
import { SEED } from './helpers/constants.js'
import { loginAsUser1 } from './helpers/session.js'
import { goToInventory, goToStockDetail } from './helpers/navigation.js'

/**
 * Pinned products (T095): a per-user shortcut at the top of the inventory.
 *
 * Each test unpins what it pinned, because the pin survives in the database
 * and the cap is only four — a leaked pin would starve the next run.
 */
test.describe('Pinned products', () => {
  const STOCK = SEED.stocks.hidroferol

  test.beforeEach(async ({ page }) => {
    await loginAsUser1(page)
    await goToInventory(page)
    await expect(page.getByTestId('product-card').first()).toBeVisible()
  })

  const pinnedSection = (page) => page.getByTestId('pinned-section')

  test('pinning from the detail page adds a shortcut without leaving its group', async ({ page }) => {
    await expect(pinnedSection(page)).toHaveCount(0)

    await goToStockDetail(page, 'hidroferol')
    const pin = page.getByTestId('pin-toggle')
    await expect(pin).toHaveAttribute('data-pinned', 'false')
    await pin.click()
    await expect(pin).toHaveAttribute('data-pinned', 'true')

    await goToInventory(page)
    await expect(pinnedSection(page)).toBeVisible()
    await expect(pinnedSection(page).getByTestId('product-card')).toHaveCount(1)
    await expect(pinnedSection(page).getByTestId('product-card').first()).toContainText(STOCK)

    // Still in its group: the section is a shortcut, not a move.
    const inGroup = page.getByTestId('group-box').getByTestId('product-card').filter({ hasText: STOCK })
    await expect(inGroup).toHaveCount(1)
    // Two rows on screen for the same product.
    await expect(page.getByTestId('product-card').filter({ hasText: STOCK })).toHaveCount(2)

    await goToStockDetail(page, 'hidroferol')
    await page.getByTestId('pin-toggle').click()
    await expect(page.getByTestId('pin-toggle')).toHaveAttribute('data-pinned', 'false')
    await goToInventory(page)
    await expect(pinnedSection(page)).toHaveCount(0)
  })

  test('the section hides while filtering and returns when cleared', async ({ page }) => {
    await goToStockDetail(page, 'hidroferol')
    await page.getByTestId('pin-toggle').click()
    await expect(page.getByTestId('pin-toggle')).toHaveAttribute('data-pinned', 'true')
    await goToInventory(page)
    await expect(pinnedSection(page)).toBeVisible()

    await page.getByTestId('stock-search').fill('hidro')
    await expect(pinnedSection(page)).toHaveCount(0)

    await page.getByTestId('stock-search-clear').click()
    await expect(pinnedSection(page)).toBeVisible()

    await goToStockDetail(page, 'hidroferol')
    await page.getByTestId('pin-toggle').click()
    await expect(page.getByTestId('pin-toggle')).toHaveAttribute('data-pinned', 'false')
  })

  test('the fifth pin is refused with a message that says how to make room', async ({ page }) => {
    const keys = ['hidroferol', 'ebastine', 'paracetamol', 'biodramina']
    for (const key of keys) {
      await goToStockDetail(page, key)
      await page.getByTestId('pin-toggle').click()
      await expect(page.getByTestId('pin-toggle')).toHaveAttribute('data-pinned', 'true')
    }

    await goToInventory(page)
    await expect(pinnedSection(page).getByTestId('product-card')).toHaveCount(4)

    await goToStockDetail(page, 'ibuprofen')
    const fifth = page.getByTestId('pin-toggle')
    await expect(fifth).toHaveAttribute('aria-disabled', 'true')
    await expect(fifth).toHaveAttribute('title', /remove one to add this/i)

    // `force` because Playwright treats `aria-disabled` as not actionable and
    // would wait for ever. A real pointer click does reach the handler, and
    // that is the path being tested: the control explains itself instead of
    // failing silently.
    await fifth.click({ force: true })
    await expect(page.getByText(/remove one to add this/i)).toBeVisible()
    await expect(fifth).toHaveAttribute('data-pinned', 'false')

    for (const key of keys) {
      await goToStockDetail(page, key)
      await page.getByTestId('pin-toggle').click()
      await expect(page.getByTestId('pin-toggle')).toHaveAttribute('data-pinned', 'false')
    }
  })
})
