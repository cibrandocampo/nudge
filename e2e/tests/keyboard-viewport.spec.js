import { test, expect } from '@playwright/test'
import { goToSettings, loginAsUser1 } from './helpers.js'

/**
 * The on-screen keyboard shrinks the visible height (UX-026, UX-027). Headless
 * Chromium has no keyboard, so a smaller viewport with a focused field stands
 * in for it: that is the signal `useKeyboardOpen` reads.
 */
const PHONE = { width: 412, height: 900 }
const WITH_KEYBOARD = { width: 412, height: 420 }

async function openChangePassword(page) {
  await goToSettings(page)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

test.describe('On-screen keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE)
    await loginAsUser1(page)
  })

  test('a modal fits the visible height and its actions can be reached', async ({ page }) => {
    await openChangePassword(page)
    await page.setViewportSize({ width: 412, height: 300 })

    const box = await page.getByRole('dialog').boundingBox()
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(300)

    const submit = page.getByRole('dialog').locator('button[type="submit"]')
    await submit.scrollIntoViewIfNeeded()
    await expect(submit).toBeInViewport({ ratio: 1 })
  })

  test('the bottom bar hides while the keyboard is up', async ({ page }) => {
    await openChangePassword(page)
    await page.getByLabel('Current password').focus()

    await page.setViewportSize(WITH_KEYBOARD)

    await expect(page.locator('nav')).toBeHidden()
  })

  test('the bottom bar comes back when the keyboard closes', async ({ page }) => {
    await openChangePassword(page)
    await page.getByLabel('Current password').focus()
    await page.setViewportSize(WITH_KEYBOARD)
    await expect(page.locator('nav')).toBeHidden()

    await page.setViewportSize(PHONE)

    await expect(page.locator('nav')).toBeVisible()
  })

  test('a smaller window with no field focused keeps the bottom bar', async ({ page }) => {
    await goToSettings(page)

    await page.setViewportSize(WITH_KEYBOARD)

    await expect(page.locator('nav')).toBeVisible()
  })
})
