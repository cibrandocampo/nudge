import { test, expect } from '@playwright/test'
import { login, SEED } from './helpers.js'

test.describe('Auth', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByAltText('Nudge')).toBeVisible()
    // Email-based wizard (T193+): step 1 is the email field + Continue.
    await expect(page.getByPlaceholder('Email')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
  })

  test('wrong credentials shows error', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder('Email').fill(SEED.admin.email)
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByPlaceholder('Password').fill('wrong-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText(/invalid/i)).toBeVisible()
  })

  test('correct credentials redirects to dashboard', async ({ page }) => {
    await login(page)
    await expect(page).toHaveURL('/')
    await expect(page.getByText('Today')).toBeVisible()
    // Blindaje offline: ningún assert debería rendir con el backend caído.
    await expect(page.getByTestId('offline-banner')).toBeHidden()
  })

  test('unauthenticated access redirects to login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL('/login')
  })

  test('sign out clears session', async ({ page }) => {
    await login(page)
    // The old user-menu dropdown was replaced by a single Header button
    // whose aria-label is "Sign out". `exact: true` disambiguates it
    // from the "Sign in" button on the login page that renders after.
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page).toHaveURL('/login')
    await page.goto('/')
    await expect(page).toHaveURL('/login')
  })
})
