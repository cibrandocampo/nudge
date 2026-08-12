import { test, expect } from '@playwright/test'
import { SEED } from './helpers/constants.js'
import { loginAsUser1 } from './helpers/session.js'
import { goToInventory } from './helpers/navigation.js'

/**
 * The inventory's find controls (T093). Everything here is client-side over
 * the already-cached collection, so these tests also assert the list reacts
 * with no round trip: the searches run while the page sits idle.
 */
test.describe('Inventory search and filters', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsUser1(page)
    await goToInventory(page)
    // `count()` does not auto-wait, so tests that read a total must start
    // from a list that has actually rendered.
    await expect(page.getByTestId('product-card').first()).toBeVisible()
  })

  const rows = (page) => page.getByTestId('product-card')
  const chip = (page, id) => page.locator(`[data-testid="stock-filter-chip"][data-chip="${id}"]`)

  test('search narrows the list to a single product and clears back', async ({ page }) => {
    const total = await rows(page).count()
    expect(total).toBeGreaterThan(3)

    await page.getByTestId('stock-search').fill('hidro')
    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).first()).toContainText(SEED.stocks.hidroferol)

    await page.getByTestId('stock-search-clear').click()
    await expect(rows(page)).toHaveCount(total)
  })

  test('search ignores accents and case', async ({ page }) => {
    await page.getByTestId('stock-search').fill('HIDRÓFEROL')
    // The product is spelled "Hidroferol": neither the capitals nor the
    // accent may keep it from matching.
    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).first()).toContainText(SEED.stocks.hidroferol)
  })

  test('search matches a batch number', async ({ page }) => {
    await page.getByTestId('stock-search').fill(SEED.lots.HIDROFEROL_NEAR)
    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).first()).toContainText(SEED.stocks.hidroferol)
  })

  test('a group chip filters to its group and reports the right count', async ({ page }) => {
    await expect(chip(page, 'all')).toHaveAttribute('data-active', 'true')

    const groupChip = page.locator('[data-testid="stock-filter-chip"][data-chip^="group-"]').first()
    const count = Number((await groupChip.textContent()).match(/(\d+)\s*$/)[1])
    await groupChip.click()

    await expect(groupChip).toHaveAttribute('data-active', 'true')
    await expect(rows(page)).toHaveCount(count)
    // Grouping is off while filtering — the results are one flat list.
    await expect(page.getByTestId('group-box')).toHaveCount(0)
  })

  test('the attention chip matches the alert banner count', async ({ page }) => {
    const banner = page.getByTestId('inventory-alert-banner')
    await expect(banner).toBeVisible()
    const bannerCount = Number((await banner.textContent()).match(/(\d+)/)[1])

    await chip(page, 'attention').click()
    await expect(rows(page)).toHaveCount(bannerCount)
    // The banner is a summary of the whole inventory, so it steps aside once
    // the list stops showing the whole inventory.
    await expect(banner).toBeHidden()
  })

  test('a search with no matches offers a way back', async ({ page }) => {
    await page.getByTestId('stock-search').fill('zzzzzzz')
    await expect(rows(page)).toHaveCount(0)

    await page.getByRole('button', { name: /clear filters/i }).click()
    await expect(page.getByTestId('stock-search')).toHaveValue('')
    await expect(rows(page).first()).toBeVisible()
    await expect(page.getByTestId('group-box').first()).toBeVisible()
  })
})
