import { test, expect } from '@playwright/test'
import { login } from './helpers.js'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test('shows Today and Upcoming sections', async ({ page }) => {
    await expect(page.getByText('Today')).toBeVisible()
    await expect(page.getByText('Upcoming')).toBeVisible()
  })

  test('has New routine button', async ({ page }) => {
    await expect(page.getByRole('link', { name: '+ New routine' })).toBeVisible()
  })

  test('bottom nav is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'History' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Inventory' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
  })
})
