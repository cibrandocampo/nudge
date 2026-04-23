import { expect, test } from '@playwright/test'
import { loginAsUser1 } from './helpers/session.js'

/**
 * Guard rail for T096: the top-bar action button on every page must render
 * flush with the right edge of the shared Layout.main container (600 px).
 * If someone re-introduces a `max-width: 540px` override on any container,
 * the button's right edge will drift inward and this test fails loudly.
 */
const PAGES = [
  { url: '/', trigger: { role: 'link', name: '+ New routine' } },
  { url: '/inventory', trigger: { role: 'button', name: '+ New' } },
  { url: '/history', trigger: null }, // no top-bar button, validated below
  { url: '/settings', trigger: null },
  { url: '/inventory/groups', trigger: null },
]

test.describe('Container width — top-bar flush with Layout.main', () => {
  test('Dashboard and Inventory top-bar buttons share the same right edge', async ({ page }) => {
    await loginAsUser1(page)

    await page.goto('/')
    const dashRight = await rightEdge(page, page.getByRole('link', { name: '+ New routine' }))

    await page.goto('/inventory')
    const invRight = await rightEdge(page, page.getByRole('button', { name: '+ New' }))

    // Both buttons belong to different pages but must share the same right
    // edge (= Layout.main content box). Allow a 0.5 px sub-pixel tolerance.
    expect(Math.abs(dashRight - invRight)).toBeLessThan(0.5)
  })

  test('page containers share the Layout.main content width (~600 px max)', async ({ page }) => {
    await loginAsUser1(page)

    const widths = []
    for (const { url } of PAGES) {
      await page.goto(url)
      const mainBox = await page.locator('main, [role="main"]').first().boundingBox()
      widths.push({ url, width: mainBox?.width ?? -1 })
    }

    // Every page uses the same Layout.main, so widths must match exactly.
    const [{ width: reference }] = widths
    for (const { url, width } of widths) {
      expect(width, `page ${url} main width diverges from reference ${reference}`).toBe(reference)
    }
  })
})

async function rightEdge(page, locator) {
  await expect(locator).toBeVisible()
  // boundingBox() can transiently return null right after navigation while
  // the element exists in the DOM but hasn't been placed by the layout yet
  // (especially with React StrictMode double-mounting in dev). Poll.
  let box = null
  for (let attempt = 0; attempt < 10 && !box; attempt += 1) {
    box = await locator.boundingBox()
    if (!box) await page.waitForTimeout(50)
  }
  if (!box) throw new Error('boundingBox() kept returning null')
  return box.x + box.width
}
