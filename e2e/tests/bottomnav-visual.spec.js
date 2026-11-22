import { expect, test } from '@playwright/test'
import { loginAsUser1 } from './helpers.js'

/**
 * Bottom bar V2 (T151, UX-012): every tab is labelled, not only the active
 * one (that was T105, overturned), and a sliding tile sits behind the active
 * tab. jsdom applies no CSS, so these two contracts live here.
 */
test.describe('Bottom bar', () => {
  // A phone: T105 hid the inactive labels only below 600 px.
  test.use({ viewport: { width: 412, height: 915 } })

  test.beforeEach(async ({ page }) => {
    await loginAsUser1(page)
    await page.waitForURL('/')
    await expect(page.locator('nav').first()).toBeVisible()
  })

  test('every tab shows its label, whole', async ({ page }) => {
    const labels = await page.locator('nav').first().evaluate((nav) =>
      [...nav.querySelectorAll('a, button')].map((tab) => {
        // tab > linkInner > [iconWrap, label]: the icon box also has span children (the dots)
        const label = tab.querySelector(':scope > span > span:last-child')
        const r = label.getBoundingClientRect()
        const t = tab.getBoundingClientRect()
        return {
          text: label.textContent,
          shown: getComputedStyle(label).display !== 'none' && getComputedStyle(label).opacity !== '0' && r.height > 0,
          whole: label.scrollWidth <= label.clientWidth + 1 && r.left >= t.left - 0.5 && r.right <= t.right + 0.5,
        }
      }),
    )
    expect(labels).toEqual([
      { text: 'Routines', shown: true, whole: true },
      { text: 'Inventory', shown: true, whole: true },
      { text: 'History', shown: true, whole: true },
      { text: 'Settings', shown: true, whole: true },
    ])
  })

  test('the selection tile sits on the active tab', async ({ page }) => {
    const nav = page.locator('nav').first()
    await page.locator('nav a[href="/inventory"]').click()
    await expect(page.locator('nav a[aria-current="page"]')).toHaveAttribute('href', '/inventory')
    await expect
      .poll(async () => {
        const tile = await nav.getByTestId('nav-indicator').boundingBox()
        const tab = await nav.locator('a[href="/inventory"]').boundingBox()
        return Math.abs(tile.x - tab.x) <= 1 && Math.abs(tile.width - tab.width) <= 1
      })
      .toBe(true)
  })
})
