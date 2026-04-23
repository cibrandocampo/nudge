import { expect, test } from '@playwright/test'
import { loginAsUser1 } from './helpers.js'

test('capture BottomNav active tab styling', async ({ page }) => {
  await loginAsUser1(page)
  await page.waitForURL('/')

  const nav = page.locator('nav').first()
  await nav.waitFor({ state: 'visible' })

  const active = nav.getByRole('link', { name: /Routines|Rutinas/i })
  await expect(active).toBeVisible()

  const computed = await active.evaluate((el) => {
    const cs = getComputedStyle(el)
    const label = el.querySelector('span > span:not([aria-hidden])') || el.querySelector('span')
    const labelCs = label ? getComputedStyle(label) : null
    return {
      anchorColor: cs.color,
      anchorFontWeight: cs.fontWeight,
      labelColor: labelCs?.color ?? null,
      labelFontWeight: labelCs?.fontWeight ?? null,
    }
  })
  console.log('BOTTOM_NAV_ACTIVE_COMPUTED', JSON.stringify(computed))

  await nav.screenshot({ path: 'test-results/bottomnav.png' })
})
