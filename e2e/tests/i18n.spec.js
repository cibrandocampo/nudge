import { test, expect } from '@playwright/test'
import { loginAsUser3, resetSeed, goToSettings, goToDashboard, goToInventory } from './helpers.js'

/**
 * T040 — Language switch flows.
 *
 * user3 is the subject in every test: the seed (T073) initialises
 * user3.language='gl' so changes leave user1 and user2 untouched.
 * Each test uses `resetSeed` in beforeEach so the starting state
 * is a deterministic 'gl' session every time.
 *
 * The expected strings come directly from the i18n JSON files
 * (`frontend/src/i18n/{en,es,gl}.json`) — do NOT invent them; if
 * the locale file renames a key the test must notice immediately.
 *
 *   settings.title:      Settings / Ajustes / Axustes
 *   dashboard.today:     Today    / Hoy     / Hoxe
 *   inventory.title:     Inventory / Inventario / Inventario
 */
test.describe('i18n language switch', () => {
  test.beforeEach(async ({ page, context }) => {
    await resetSeed(context)
    await loginAsUser3(page)
    await expect(page.getByTestId('offline-banner')).toBeHidden()
  })

  test('clicking English switches the Settings heading immediately', async ({ page }) => {
    await goToSettings(page)
    await expect(page.getByRole('heading', { name: 'Axustes', level: 1 })).toBeVisible()

    await page.getByRole('button', { name: 'English', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  })

  test('the new language persists across a page reload', async ({ page }) => {
    await goToSettings(page)
    await page.getByRole('button', { name: 'English', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()

    await page.reload()
    // `AuthContext` refetches /auth/me/ and applies user.language on
    // mount, so after the reload the UI must still be in English.
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  })

  test('switching language propagates to Dashboard and Inventory', async ({ page }) => {
    await goToSettings(page)
    await page.getByRole('button', { name: 'English', exact: true }).click()

    await goToDashboard(page)
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()

    await goToInventory(page)
    await expect(page.getByRole('heading', { name: 'Inventory', level: 1 })).toBeVisible()
  })
})
