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

  test('create a stock item via the form page', async ({ page }) => {
    const name = `Test item ${Date.now()}`

    await page.getByRole('button', { name: '+ New' }).click()
    await expect(page).toHaveURL('/inventory/new')

    await page.getByLabel('Name').fill(name)
    await page.getByRole('button', { name: 'Create' }).click()

    await expect(page).toHaveURL(/\/inventory\/\d+$/)
    // Navigate back and confirm the card is listed.
    await page.getByRole('link', { name: /back to inventory/i }).click()
    await expect(page.locator('[data-testid="product-card"]').filter({ hasText: name })).toBeVisible()
  })

  test('create a stock item with two initial batches', async ({ page }) => {
    const name = `Batch test ${Date.now()}`

    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByLabel('Name').fill(name)

    const addBatchBtn = page.getByRole('button', { name: 'Add batch' })
    await addBatchBtn.click()
    await addBatchBtn.click()

    const qtyInputs = page.getByLabel(/Batch \d+ quantity/)
    await qtyInputs.nth(0).fill('3')
    await qtyInputs.nth(1).fill('5')

    await page.getByRole('button', { name: 'Create' }).click()

    // Detail page shows total 8 units across the two lots.
    await expect(page).toHaveURL(/\/inventory\/\d+$/)
    await expect(page.getByText('8 total')).toBeVisible()
  })

  test('delete a stock item from its detail page', async ({ page }) => {
    const name = `Delete item ${Date.now()}`

    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByLabel('Name').fill(name)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page).toHaveURL(/\/inventory\/\d+$/)

    await page.getByRole('button', { name: 'Delete stock' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete stock' }).click()

    await expect(page).toHaveURL('/inventory')
    await expect(page.locator('[data-testid="product-card"]').filter({ hasText: name })).toHaveCount(0)
  })

  test('add and delete a lot from the detail page', async ({ page }) => {
    const name = `Lot flow ${Date.now()}`

    // Create an empty stock first.
    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByLabel('Name').fill(name)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page).toHaveURL(/\/inventory\/\d+$/)

    // Detail page still hosts lot CRUD. Fill the add-batch form.
    await page.getByPlaceholder('0').fill('3')
    await page.getByRole('button', { name: 'Add batch' }).click()
    // Wait for the optimistic lot to settle into the list.
    await expect(page.getByText('3 total', { exact: false })).toBeVisible({ timeout: 10_000 })

    // Delete the lot via the trash icon + confirm.
    await page.getByTitle('Delete').last().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()

    await expect(page.getByText('0 total', { exact: false })).toBeVisible({ timeout: 10_000 })
  })
})
