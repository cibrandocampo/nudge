import { test, expect } from '@playwright/test'

test.describe('Django Admin', () => {
  test('admin login page loads with CSS', async ({ page }) => {
    await page.goto('/admin/')
    // Verify the Django admin branding header is present
    await expect(page.locator('#site-name')).toBeVisible()
    // Verify the login form elements are present (CSS loaded)
    await expect(page.getByLabel('Username:')).toBeVisible()
  })

  test('admin login with wrong credentials', async ({ page }) => {
    await page.goto('/admin/')
    await page.getByLabel('Username:').fill('admin')
    await page.getByLabel('Password:').fill('wrong')
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page.getByText(/please enter the correct/i)).toBeVisible()
  })

  test('admin login with correct credentials', async ({ page }) => {
    await page.goto('/admin/')
    await page.getByLabel('Username:').fill('admin')
    await page.getByLabel('Password:').fill('nudge-admin-2026')
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page).toHaveURL('/admin/')
    await expect(page.getByText(/site administration/i)).toBeVisible()
  })

  test('admin shows nudge models', async ({ page }) => {
    await page.goto('/admin/')
    await page.getByLabel('Username:').fill('admin')
    await page.getByLabel('Password:').fill('nudge-admin-2026')
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page.getByRole('link', { name: 'Routines' }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Users' }).first()).toBeVisible()
  })
})
