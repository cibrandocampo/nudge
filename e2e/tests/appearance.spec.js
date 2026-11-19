/**
 * Appearance from the profile (T148, docs/plans/ux-audit-roadmap.md phase 1).
 *
 * Theme, text size and language live on the profile and apply to the whole
 * app from the start: `main.jsx` paints this device's last appearance before
 * the first render, and `AppearanceProvider` applies the profile once
 * `/api/auth/me/` loads. user1 (cibran) starts at «System» / «Normal» / en;
 * user2 (María) has `language: 'es'` in the seed.
 */
import { test, expect } from '@playwright/test'
import { goToDashboard, goToSettings, loginAsUser1, loginAsUser2, resetSeed } from './helpers.js'

const DARK_BG = 'rgb(20, 22, 29)' // --c-bg #14161d
const LIGHT_BG = 'rgb(250, 250, 250)' // --c-bg #fafafa

const bodyBackground = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)

/** Press an option in Settings and wait until the profile has saved it. */
async function choose(page, group, option) {
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/auth/me/') && r.request().method() === 'PATCH')
  await page.getByRole('group', { name: group }).getByRole('button', { name: option, exact: true }).click()
  expect((await saved).ok()).toBe(true)
}

test.describe('appearance', () => {
  test.beforeEach(async ({ context }) => {
    await resetSeed(context)
  })

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext()
    await resetSeed(context)
    await context.close()
  })

  test('«Dark» applies at once and survives a reload without a light frame', async ({ page }) => {
    await loginAsUser1(page)
    await goToSettings(page)
    expect(await bodyBackground(page)).toBe(LIGHT_BG)

    await choose(page, 'Theme', 'Dark')
    expect(await bodyBackground(page)).toBe(DARK_BG)

    // At DOMContentLoaded the profile has not loaded yet: what shows is what
    // main.jsx applied from this device's copy, before React rendered.
    await page.reload({ waitUntil: 'domcontentloaded' })
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
    expect(await bodyBackground(page)).toBe(DARK_BG)
  })

  test('«Extra large» makes the root 20 px and Today still fits 412 px', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 })
    await loginAsUser1(page)
    await goToSettings(page)

    await choose(page, 'Text size', 'Extra large')
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('20px')

    await goToDashboard(page)
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('another device gets the profile appearance on sign-in', async ({ page, browser }) => {
    await loginAsUser1(page)
    await goToSettings(page)
    await choose(page, 'Theme', 'Dark')
    await choose(page, 'Text size', 'Large')

    // A fresh context has no stored copy: only the profile can make it dark.
    const other = await browser.newContext()
    try {
      const phone = await other.newPage()
      await loginAsUser1(phone)
      await expect(phone.locator('html')).toHaveAttribute('data-theme', 'dark')
      expect(await bodyBackground(phone)).toBe(DARK_BG)
      expect(await phone.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('18px')
    } finally {
      await other.close()
    }
  })

  test('a Spanish profile sees Today in Spanish without opening Settings', async ({ page }) => {
    await loginAsUser2(page)
    await expect(page.getByRole('heading', { name: 'Hoy' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ajustes' })).toBeVisible()
  })
})
