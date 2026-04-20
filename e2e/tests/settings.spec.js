import { test, expect } from '@playwright/test'
import { login, SEED } from './helpers.js'

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    // Reset language to English so all text assertions work regardless of stored preference
    await page.evaluate(async () => {
      const token = localStorage.getItem('access_token')
      await fetch('/api/auth/me/', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'en' }),
      })
    })
    await page.reload()
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL('/settings')
    await expect(page.getByTestId('offline-banner')).toBeHidden()
  })

  test('settings page loads', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.getByText('Profile')).toBeVisible()
    await expect(page.getByText('Timezone', { exact: true })).toBeVisible()
    await expect(page.getByText('Push notifications')).toBeVisible()
  })

  test('shows username', async ({ page }) => {
    // Profile block renders the username as an h2 (T042 Profile redesign).
    await expect(
      page.getByRole('heading', { level: 2, name: new RegExp(`^${SEED.admin.username}$`) }),
    ).toBeVisible()
  })

  test('save timezone change', async ({ page }) => {
    // The timezone picker is a Combobox (T044). Interact via its combobox
    // input + listbox options, not the old native `select[size]`.
    const tzInput = page.getByPlaceholder('Search timezone…')
    await tzInput.click()
    await tzInput.fill('Madrid')

    await page.getByRole('option', { name: 'Europe/Madrid' }).click()

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
