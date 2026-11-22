import { test, expect } from '@playwright/test'
import { SEED } from './helpers/constants.js'
import { loginAsUser1 } from './helpers/session.js'
import { goToInventory, goToStockDetail } from './helpers/navigation.js'
import { stockCard } from './helpers/locators.js'

/**
 * The inventory as one list with one active filter (T204): it opens on
 * Featured, a product in two categories is listed once and shows up under
 * both, and the search always covers everything.
 *
 * A small viewport so the list is guaranteed to scroll.
 */
test.use({ viewport: { width: 390, height: 640 } })

const rows = (page) => page.getByTestId('product-card')
const chip = (page, id) => page.locator(`[data-testid="stock-filter-chip"][data-chip="${id}"]`)
const groupChip = (page, name) =>
  page.locator('[data-testid="stock-filter-chip"][data-chip^="group-"]').filter({ hasText: name })

test.describe('Inventory list', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsUser1(page)
  })

  test('opens on Featured and lists nothing else', async ({ page }) => {
    await goToInventory(page, { filter: null })
    await expect(chip(page, 'featured')).toHaveAttribute('data-active', 'true')
    await expect(rows(page)).toHaveCount(SEED.pinnedForUser1.length)
  })

  test('Attention is on offer from the default view', async ({ page }) => {
    await goToInventory(page, { filter: null })
    await expect(chip(page, 'attention')).toBeVisible()
    await expect(chip(page, 'attention')).toBeInViewport()
  })

  test('a product in two categories is under both and once under All', async ({ page }) => {
    await goToInventory(page)
    await expect(stockCard(page, 'hidroferol')).toHaveCount(1)

    for (const name of ['Diabetes', 'Medicine cabinet']) {
      await groupChip(page, name).click()
      await expect(stockCard(page, 'hidroferol')).toHaveCount(1)
    }
  })

  test('the search finds a product outside the active filter', async ({ page }) => {
    await goToInventory(page, { filter: null })
    await expect(stockCard(page, 'ebastine')).toHaveCount(0)

    await page.getByTestId('stock-search').fill('ebast')
    await expect(rows(page)).toHaveCount(1)
    await expect(stockCard(page, 'ebastine')).toHaveCount(1)
    await expect(chip(page, 'featured')).toHaveAttribute('data-active', 'true')

    await page.getByTestId('stock-search-clear').click()
    await expect(stockCard(page, 'ebastine')).toHaveCount(0)
  })

  test('the chosen filter survives visiting a product', async ({ page }) => {
    await goToInventory(page)
    await groupChip(page, 'Travel').click()
    await expect(rows(page)).toHaveCount(1)

    await rows(page).first().getByTestId('row-open-detail').click()
    await expect(page).toHaveURL(/\/inventory\/\d+$/)
    await page.getByRole('link', { name: /back to inventory/i }).click()
    await expect(page).toHaveURL('/inventory')

    await expect(groupChip(page, 'Travel')).toHaveAttribute('data-active', 'true')
    await expect(rows(page)).toHaveCount(1)
  })

  test('coming back from a product returns to where you were in the list', async ({ page }) => {
    await goToInventory(page)
    await expect(rows(page).first()).toBeVisible()
    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)
    expect(scrollable, 'the list must be taller than the viewport for this test to mean anything').toBe(true)

    await page.evaluate(() => window.scrollTo(0, 300))
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(200)

    // A row already on screen: clicking an off-screen one would make Playwright
    // scroll first, and the test would assert its own scroll.
    let open = null
    // Not the seeded insulin: it opens with the official-name offer on top.
    for (const row of await rows(page).filter({ hasNotText: 'Fast-acting insulin' }).all()) {
      const candidate = row.getByTestId('row-open-detail')
      const box = await candidate.boundingBox()
      if (box && box.y > 260 && box.y + box.height < 540) {
        open = candidate
        break
      }
    }
    expect(open, 'a row must be fully on screen').not.toBeNull()
    const before = await page.evaluate(() => Math.round(window.scrollY))
    await open.click()
    await expect(page).toHaveURL(/\/inventory\/\d+$/)

    await page.getByRole('link', { name: /back to inventory/i }).click()
    await expect(page).toHaveURL('/inventory')
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(before - 40)
  })

  test('unpinning the last featured product falls back to All', async ({ page }) => {
    await goToInventory(page, { filter: null })
    for (const key of SEED.pinnedForUser1) {
      await goToStockDetail(page, key)
      await page.getByTestId('pin-toggle').click()
      await expect(page.getByTestId('pin-toggle')).toHaveAttribute('data-pinned', 'false')
    }
    await goToInventory(page, { filter: null })
    await expect(chip(page, 'featured')).toHaveCount(0)
    await expect(chip(page, 'all')).toHaveAttribute('data-active', 'true')
  })
})
