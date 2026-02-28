import { test, expect } from '@playwright/test'
import { login, CREDS } from './helpers.js'

test.describe('Auth', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByText('Nudge')).toBeVisible()
    await expect(page.getByPlaceholder('Username')).toBeVisible()
    await expect(page.getByPlaceholder('Password')).toBeVisible()
  })

  test('wrong credentials shows error', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder('Username').fill(CREDS.username)
    await page.getByPlaceholder('Password').fill('wrong-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText(/invalid/i)).toBeVisible()
  })

  test('correct credentials redirects to dashboard', async ({ page }) => {
    await login(page)
    await expect(page).toHaveURL('/')
    await expect(page.getByText('Today')).toBeVisible()
  })

  test('unauthenticated access redirects to login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL('/login')
  })

  test('sign out clears session', async ({ page }) => {
    await login(page)
    await page.goto('/settings')
    // Sign out is inside the header dropdown — open via the user button (has ▾ chevron)
    await page.getByRole('button', { name: /▾/ }).click()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL('/login')
    await page.goto('/')
    await expect(page).toHaveURL('/login')
  })
})
