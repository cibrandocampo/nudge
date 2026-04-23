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
    // Profile block renders the username as an h2. When the user also has
    // a first/last name populated, the heading reads "First Last (username)";
    // otherwise just "username". Use a substring assertion so the test
    // works in both configurations. `.first()` avoids strict-mode
    // violations when other h2s appear (e.g. the dashboard section
    // header above the profile, or future sections).
    await expect(page.getByRole('heading', { level: 2 }).first()).toContainText(SEED.admin.username)
  })

  test('save timezone change', async ({ page }) => {
    // SettingsPage autosaves the timezone on selection — no "Save changes"
    // button any more. Hop through two timezones so at least one is a
    // change regardless of the admin's existing setting, then reload and
    // assert the last pick survives the round-trip.
    const tzInput = page.getByPlaceholder('Search timezone…')

    await tzInput.click()
    await tzInput.fill('Tokyo')
    await page.getByRole('option', { name: 'Asia/Tokyo' }).click()

    await tzInput.click()
    await tzInput.fill('Madrid')
    await page.getByRole('option', { name: 'Europe/Madrid' }).click()

    await page.reload()
    await expect(page.getByPlaceholder('Search timezone…')).toHaveValue('Europe/Madrid')
  })

  test('shows push notification status', async ({ page }) => {
    await expect(page.getByText('Push notifications')).toBeVisible()
    // Should show some status (granted/not enabled/blocked)
    const section = page.locator('div').filter({ hasText: 'Push notifications' }).last()
    await expect(section).toBeVisible()
  })
})
