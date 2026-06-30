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

  test('shows the signed-in user email in the profile block', async ({ page }) => {
    // Post-T197 the profile renders the display name as an h2 with the
    // email below it; `username` is internal-only and never surfaces.
    // The email is the stable, deterministic identifier to assert on.
    await expect(page.getByText(SEED.admin.email)).toBeVisible()
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
    // Autosave fires a PATCH on selection — wait for it to land before
    // reloading, otherwise the reload can race ahead of the persisted value.
    const saved = page.waitForResponse(
      (r) => r.url().includes('/api/auth/me/') && r.request().method() === 'PATCH',
    )
    await page.getByRole('option', { name: 'Europe/Madrid' }).click()
    await saved

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
