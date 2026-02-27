import { test, expect } from '@playwright/test'
import { login } from './helpers.js'

test.describe('Inventory', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.getByRole('link', { name: 'Inventory' }).click()
    await expect(page).toHaveURL('/inventory')
  })

  test('inventory page loads', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible()
    await expect(page.getByRole('button', { name: '+ New' })).toBeVisible()
  })

  test('create a stock item', async ({ page }) => {
    const name = `Test item ${Date.now()}`

    await page.getByRole('button', { name: '+ New' }).click()
    await expect(page.getByPlaceholder(/item name/i)).toBeVisible()
    await page.getByPlaceholder(/item name/i).fill(name)
    await page.getByRole('button', { name: 'Create item' }).click()

    await expect(page.locator('[data-testid="product-card"]').filter({ hasText: name })).toBeVisible()
  })

  test('add a lot to a stock item', async ({ page }) => {
    // Create an item first
    const name = `Lot test ${Date.now()}`
    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByPlaceholder(/item name/i).fill(name)
    await page.getByRole('button', { name: 'Create item' }).click()

    const card = page.locator('[data-testid="product-card"]').filter({ hasText: name })
    await expect(card).toBeVisible()

    // Open the "Add batch" form
    await card.getByRole('button', { name: /add batch/i }).click()

    // Fill quantity and submit
    await card.locator('input[type="number"]').fill('5')
    await card.getByRole('button', { name: /add batch/i }).last().click()

    // Total quantity should now show 5
    await expect(card.getByText('5 ud.')).toBeVisible()
  })

  test('delete a stock item', async ({ page }) => {
    // Create an item first
    const name = `Delete item ${Date.now()}`
    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByPlaceholder(/item name/i).fill(name)
    await page.getByRole('button', { name: 'Create item' }).click()

    const card = page.locator('[data-testid="product-card"]').filter({ hasText: name })
    await expect(card).toBeVisible()

    // Click ✕ delete button on the product card header
    await card.getByTitle('Delete').click()

    // Confirm the modal
    await page.getByRole('button', { name: 'Delete' }).last().click()

    await expect(card).not.toBeVisible()
  })

  test('delete a lot', async ({ page }) => {
    // Create an item and add a lot
    const name = `Lot delete ${Date.now()}`
    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByPlaceholder(/item name/i).fill(name)
    await page.getByRole('button', { name: 'Create item' }).click()

    const card = page.locator('[data-testid="product-card"]').filter({ hasText: name })
    await expect(card).toBeVisible()

    // Add a lot
    await card.getByRole('button', { name: /add batch/i }).click()
    await card.locator('input[type="number"]').fill('3')
    await card.getByRole('button', { name: /add batch/i }).last().click()
    await expect(card.getByText('3 ud.')).toBeVisible()

    // Delete the lot using the 🗑 button
    await card.getByTitle('Delete').last().click()
    await page.getByRole('button', { name: 'Delete' }).last().click()

    // Total should be 0
    await expect(card.getByText('(0 total)')).toBeVisible()
  })
})
