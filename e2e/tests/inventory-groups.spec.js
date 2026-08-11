import { test, expect } from '@playwright/test'
import { loginAsUser1 } from './helpers/session.js'
import { goToInventory, goToStockDetail } from './helpers/navigation.js'

/**
 * Section behaviour on the inventory (T096): folding that is worth doing,
 * because it survives leaving the page, and a scroll position that survives
 * with it.
 *
 * A small viewport so the list is guaranteed to scroll — the point of the
 * scroll test is lost on a page that fits.
 */
test.use({ viewport: { width: 390, height: 640 } })

/**
 * Wait for the sections to be the ones the user will actually see.
 *
 * The stock list and the group list are two queries. Until the groups land,
 * every product is ungrouped and the page renders a single "No category"
 * section — which even carries a severity dot, since it holds everything.
 * Reading section structure before that resolves means asserting on a frame
 * the user never really sees.
 */
async function settled(page) {
  await expect(page.getByTestId('product-card').first()).toBeVisible()
  await expect(page.locator('[data-testid="group-box"]:not([data-section="ungrouped"])').first()).toBeVisible()
}

test.describe('Inventory sections', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsUser1(page)
    await goToInventory(page)
    await settled(page)
  })

  const section = (page, key) => page.locator(`[data-testid="group-box"][data-section="${key}"]`)
  const firstSectionKey = (page) =>
    page.getByTestId('group-box').first().evaluate((el) => el.dataset.section)

  test('a folded section stays folded after visiting a product', async ({ page }) => {
    const key = await firstSectionKey(page)
    const header = section(page, key).locator('> button')
    await expect(header).toHaveAttribute('aria-expanded', 'true')

    await header.click()
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    await expect(section(page, key).getByTestId('product-card')).toHaveCount(0)

    // Any product still on screen — deliberately not one from the folded
    // section, whose rows are no longer rendered to click.
    await page.getByTestId('product-card').first().getByRole('button', { name: 'Open details' }).click()
    await expect(page).toHaveURL(/\/inventory\/\d+$/)
    await page.getByRole('link', { name: /back to inventory/i }).click()
    await expect(page).toHaveURL('/inventory')

    // The whole reason folding is worth doing: it is still folded.
    await expect(section(page, key).locator('> button')).toHaveAttribute('aria-expanded', 'false')
    await expect(section(page, key).getByTestId('product-card')).toHaveCount(0)

    await section(page, key).locator('> button').click()
    await expect(section(page, key).locator('> button')).toHaveAttribute('aria-expanded', 'true')
  })

  test('coming back from a product returns to where you were in the list', async ({ page }) => {
    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)
    expect(scrollable, 'the list must be taller than the viewport for this test to mean anything').toBe(true)

    await page.evaluate(() => window.scrollTo(0, 400))
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(300)
    const before = await page.evaluate(() => Math.round(window.scrollY))

    await goToStockDetail(page, 'hidroferol')
    await page.getByRole('link', { name: /back to inventory/i }).click()
    await expect(page).toHaveURL('/inventory')

    // Restored, not reset to the top — and without turning the back link into
    // a history `back`, which would misfire from the stock form.
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(before - 40)
  })

  test('ungrouped products get a section of their own, with a count', async ({ page }) => {
    const ungrouped = section(page, 'ungrouped')
    await expect(ungrouped).toBeVisible()
    await expect(ungrouped.locator('> button')).toContainText('No category')

    // Polled: `count()` does not auto-wait, so reading it against a list that
    // is still settling compares two different moments.
    await expect
      .poll(async () => {
        const rows = await ungrouped.getByTestId('product-card').count()
        const header = await ungrouped.locator('> button').innerText()
        return header.includes(`(${rows})`) && rows > 0
      })
      .toBe(true)
  })

  test('a folded section still shows that something inside needs attention', async ({ page }) => {
    // The section is resolved to a fixed key first. A `.filter({ has: ... })
    // .first()` locator re-evaluates on every use, so a background refetch
    // between the click and the assertion can silently point it at a different
    // section — which reads as flakiness and is really an unstable handle.
    const key = await page
      .locator('[data-testid="group-box"]')
      .filter({ has: page.getByTestId('group-severity-dot') })
      .first()
      .evaluate((el) => el.dataset.section)

    const box = section(page, key)
    const severity = await box.getByTestId('group-severity-dot').getAttribute('data-severity')
    expect(severity).toMatch(/danger|warning/)

    await box.locator('> button').click()
    await expect(box.locator('> button')).toHaveAttribute('aria-expanded', 'false')
    await expect(box.getByTestId('product-card')).toHaveCount(0)
    // Still flagged after folding: that is what makes folding safe.
    await expect(box.getByTestId('group-severity-dot')).toHaveAttribute('data-severity', severity)

    await box.locator('> button').click()
    await expect(box.locator('> button')).toHaveAttribute('aria-expanded', 'true')
  })

  test('a pinned section header sits below the search bar, not under it', async ({ page }) => {
    const barBottom = await page.getByTestId('stock-search').evaluate((el) => {
      let node = el
      while (node && getComputedStyle(node).position !== 'sticky') node = node.parentElement
      // Where the bar lands once pinned: its own sticky offset plus its height.
      return 48 + Math.round(node.getBoundingClientRect().height)
    })

    await page.evaluate(() => window.scrollTo(0, 260))
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(200)

    const headerTop = await page
      .getByTestId('group-box')
      .first()
      .evaluate((el) => Math.round(el.querySelector('button').getBoundingClientRect().top))

    expect(headerTop, `header should pin at ${barBottom}px, under the bar`).toBeGreaterThanOrEqual(barBottom - 1)
  })
})

test.describe('Inventory sections — first visit', () => {
  test('nothing is folded for a user who has never folded anything', async ({ page }) => {
    await loginAsUser1(page)
    await goToInventory(page)
    await settled(page)

    // Polled before reading: `all()` does not auto-wait, so it can snapshot the
    // page mid-render and see one section where there will be several.
    await expect.poll(() => page.getByTestId('group-box').count()).toBeGreaterThan(1)

    // Only the section headers: a `getByRole('button')` inside a section also
    // matches every row's consume and open-details buttons.
    const sections = await page.getByTestId('group-box').all()
    for (const box of sections) {
      await expect(box.locator('> button')).toHaveAttribute('aria-expanded', 'true')
      await expect(box.getByTestId('product-card').first()).toBeVisible()
    }
  })
})
