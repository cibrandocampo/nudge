import { test, expect } from '@playwright/test'
import { login } from './helpers.js'

test.describe('Inventory', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.getByRole('link', { name: 'Inventory' }).click()
    await expect(page).toHaveURL('/inventory')
    await expect(page.getByTestId('offline-banner')).toBeHidden()
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
    await expect(card.getByText('5 u.')).toBeVisible()
  })

  test('delete a stock item', async ({ page }) => {
    // Create an item first
    const name = `Delete item ${Date.now()}`
    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByPlaceholder(/item name/i).fill(name)
    await page.getByRole('button', { name: 'Create item' }).click()

    const card = page.locator('[data-testid="product-card"]').filter({ hasText: name })
    await expect(card).toBeVisible()

    // Stock delete moved from card (T048) to StockDetailPage. Click the
    // card to navigate, then use the dangerous "Delete stock" button.
    await card.click()
    await expect(page).toHaveURL(/\/inventory\/\d+$/)

    await page.getByRole('button', { name: 'Delete stock' }).click()
    // Scope the confirm to the dialog so we don't race-click the page's
    // trigger button again.
    await page.getByRole('dialog').getByRole('button', { name: 'Delete stock' }).click()

    // Back to the list; the card must be gone.
    await expect(page).toHaveURL('/inventory')
    await expect(page.locator('[data-testid="product-card"]').filter({ hasText: name })).toHaveCount(0)
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
    await expect(card.getByText('3 u.')).toBeVisible()

    // Delete the lot using the 🗑 button → opens ConfirmModal.
    await card.getByTitle('Delete').last().click()

    // Scope to the dialog: the lot's delete button is the previous
    // `.last()` Delete on the page and races the modal mount. Scoping
    // to `[role="dialog"]` removes the ambiguity deterministically.
    const confirmBtn = page.getByRole('dialog').getByRole('button', { name: 'Delete' })
    await expect(confirmBtn).toBeVisible()
    await confirmBtn.click()

    // Retry-able assertion on the resulting DOM — waits for the mutation
    // to resolve and TanStack's cache invalidation to re-render the card
    // without relying on catching the exact DELETE response event
    // (which can race the test runner's listener in the full suite).
    await expect(card.getByText('(0 total)')).toBeVisible({ timeout: 10_000 })
  })
})
