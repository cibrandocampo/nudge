import { test, expect } from '@playwright/test'
import { login } from './helpers.js'

const ROUTINE_NAME = `E2E routine ${Date.now()}`

test.describe('Routines', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test('navigate to new routine form', async ({ page }) => {
    await page.getByRole('link', { name: '+ New routine' }).click()
    await expect(page).toHaveURL('/routines/new')
    await expect(page.getByText('New routine')).toBeVisible()
  })

  test('create a routine with preset interval', async ({ page }) => {
    await page.goto('/routines/new')

    await page.getByPlaceholder(/change water filter/i).fill(ROUTINE_NAME)

    // Click the "1 week" preset
    await page.getByRole('button', { name: '1 week' }).click()

    await page.getByRole('button', { name: 'Save' }).click()

    // Should redirect to routine detail
    await expect(page).toHaveURL(/\/routines\/\d+$/)
    await expect(page.getByText(ROUTINE_NAME)).toBeVisible()
    await expect(page.getByText('Every week')).toBeVisible()
  })

  test('edit a routine', async ({ page }) => {
    // Create first
    await page.goto('/routines/new')
    const name = `Edit test ${Date.now()}`
    await page.getByPlaceholder(/change water filter/i).fill(name)
    await page.getByRole('button', { name: 'Save' }).click()
    await page.waitForURL(/\/routines\/\d+$/)

    // Edit
    await page.getByRole('link', { name: 'Edit' }).click()
    await expect(page).toHaveURL(/\/routines\/\d+\/edit$/)

    const newName = name + ' (edited)'
    const nameInput = page.getByPlaceholder(/change water filter/i)
    await nameInput.clear()
    await nameInput.fill(newName)
    await page.getByRole('button', { name: 'Save' }).click()
    await page.waitForURL(/\/routines\/\d+$/)

    await expect(page.getByText(newName)).toBeVisible()
  })

  test('delete a routine', async ({ page }) => {
    // Create first
    await page.goto('/routines/new')
    const name = `Delete test ${Date.now()}`
    await page.getByPlaceholder(/change water filter/i).fill(name)
    await page.getByRole('button', { name: 'Save' }).click()
    await page.waitForURL(/\/routines\/\d+$/)

    // Delete — opens ConfirmModal, then confirm
    await page.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete' }).last().click()
    await expect(page).toHaveURL('/')
  })

  test('interval custom value and unit', async ({ page }) => {
    await page.goto('/routines/new')
    await page.getByPlaceholder(/change water filter/i).fill(`Interval test ${Date.now()}`)

    // Set 6 months via custom input
    const valueInput = page.locator('input[type="number"]').first()
    await valueInput.click()
    await valueInput.fill('6')

    const unitSelect = page.locator('select').first()
    await unitSelect.selectOption('months')

    await page.getByRole('button', { name: 'Save' }).click()
    await page.waitForURL(/\/routines\/\d+$/)

    await expect(page.getByText('Every 6 months')).toBeVisible()
  })

  test('routine form validation — empty name', async ({ page }) => {
    await page.goto('/routines/new')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText(/Name is required/)).toBeVisible()
  })
})
