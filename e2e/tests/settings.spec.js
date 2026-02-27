import { test, expect } from '@playwright/test'
import { login } from './helpers.js'

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL('/settings')
  })

  test('settings page loads', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.getByText('Profile')).toBeVisible()
    await expect(page.getByText('Timezone', { exact: true })).toBeVisible()
    await expect(page.getByText('Push notifications')).toBeVisible()
  })

  test('shows username', async ({ page }) => {
    await expect(page.locator('p').filter({ hasText: /^admin$/ })).toBeVisible()
  })

  test('save timezone change', async ({ page }) => {
    // Select Europe/London
    const tzSearch = page.getByPlaceholder('Search timezone…')
    await tzSearch.fill('Madrid')

    const select = page.locator('select[size]')
    await select.selectOption('Europe/Madrid')

    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('button', { name: 'Saved!' })).toBeVisible()
  })

  test('shows push notification status', async ({ page }) => {
    await expect(page.getByText('Push notifications')).toBeVisible()
    // Should show some status (granted/not enabled/blocked)
    const section = page.locator('div').filter({ hasText: 'Push notifications' }).last()
    await expect(section).toBeVisible()
  })
})
