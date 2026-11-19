/**
 * Dark theme (T147, docs/plans/ux-audit-roadmap.md phase 1).
 *
 * The app follows the device (`prefers-color-scheme`) unless `<html>` carries
 * `data-theme`, which the «Theme» setting sets (T148): «Light» must win over a
 * dark device and «Dark» over a light one. Read from computed styles on the
 * login page, which needs no session and uses the same tokens as every page.
 */
import { test, expect } from '@playwright/test'

const DARK_BG = 'rgb(20, 22, 29)' // --c-bg #14161d
const LIGHT_BG = 'rgb(250, 250, 250)' // --c-bg #fafafa

async function look(page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    return {
      bg: getComputedStyle(document.body).backgroundColor,
      surface: root.getPropertyValue('--c-surface').trim(),
      text: root.getPropertyValue('--c-text').trim(),
      onPrimary: root.getPropertyValue('--c-on-primary').trim(),
      colorScheme: root.colorScheme,
    }
  })
}

async function openLogin(page, theme) {
  await page.goto('/login')
  await expect(page.getByRole('textbox').first()).toBeVisible()
  if (theme) await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme)
}

test.describe('device in dark mode', () => {
  test.use({ colorScheme: 'dark' })

  test('uses the dark tokens', async ({ page }) => {
    await openLogin(page)
    expect(await look(page)).toEqual({
      bg: DARK_BG,
      surface: '#1d2029',
      text: '#e6e7ef',
      onPrimary: '#1d2029',
      colorScheme: 'dark',
    })
  })

  test('data-theme="light" wins over the device', async ({ page }) => {
    await openLogin(page, 'light')
    const tokens = await look(page)
    expect(tokens.bg).toBe(LIGHT_BG)
    expect(tokens.colorScheme).toBe('light')
  })
})

test.describe('device in light mode', () => {
  test.use({ colorScheme: 'light' })

  test('uses the light tokens', async ({ page }) => {
    await openLogin(page)
    const tokens = await look(page)
    expect(tokens.bg).toBe(LIGHT_BG)
    expect(tokens.colorScheme).toBe('light')
  })

  test('data-theme="dark" wins over the device', async ({ page }) => {
    await openLogin(page, 'dark')
    const tokens = await look(page)
    expect(tokens.bg).toBe(DARK_BG)
    expect(tokens.surface).toBe('#1d2029')
    expect(tokens.colorScheme).toBe('dark')
  })
})
