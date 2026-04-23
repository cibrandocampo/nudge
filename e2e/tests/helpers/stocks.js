import { expect } from '@playwright/test'
import { SEED } from './constants.js'
import { stockCard } from './locators.js'
import { goToInventory, goToStockDetail } from './navigation.js'

export async function createStock(page, { name }) {
  await goToInventory(page)
  await page.getByRole('button', { name: '+ New' }).click()
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Create' }).click()
  // Create navigates to the detail page — go back to the list before returning.
  await page.waitForURL(/\/inventory\/\d+$/)
  await page.getByRole('link', { name: /back to inventory/i }).click()
  await expect(stockCard(page, name)).toBeVisible()
}

export async function deleteStock(page, stockKeyOrName) {
  const name = SEED.stocks[stockKeyOrName] ?? stockKeyOrName
  await goToStockDetail(page, stockKeyOrName)
  await page.getByRole('button', { name: 'Delete stock' }).click()
  await page.getByRole('button', { name: 'Delete stock' }).last().click()
  await page.waitForURL('/inventory')
  await expect(page.getByTestId('product-card').filter({ hasText: name })).toHaveCount(0)
}

/**
 * Add a lot to an existing stock from its detail page.
 * @param {{ quantity: number, expiryDate?: string, lotNumber?: string }}
 *   `expiryDate` must be ISO `YYYY-MM-DD`. `lotNumber` can be empty for
 *   lots without SN (dedup tests).
 */
export async function addLot(page, stockKeyOrName, { quantity, expiryDate = '', lotNumber = '' }) {
  await goToStockDetail(page, stockKeyOrName)
  await page.locator('input[type="number"]').first().fill(String(quantity))
  if (expiryDate) await page.locator('input[type="date"]').first().fill(expiryDate)
  if (lotNumber) await page.getByPlaceholder(/batch id/i).fill(lotNumber)
  await page.getByRole('button', { name: 'Add batch' }).click()
}

export async function deleteLot(page, stockKeyOrName, lotNumber) {
  await goToStockDetail(page, stockKeyOrName)
  const row = page.locator('[class*="lotRow"]').filter({ hasText: lotNumber }).first()
  await row.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Delete' }).last().click()
}

/**
 * Consume N units of a stock from the inventory list (single-unit quick
 * button, tapped `quantity` times).
 */
export async function consumeStock(page, stockKeyOrName, quantity = 1) {
  await goToInventory(page)
  const card = stockCard(page, stockKeyOrName)
  for (let i = 0; i < quantity; i += 1) {
    await card.getByRole('button', { name: 'Consume 1 unit' }).click()
  }
}

/**
 * Share (or toggle — call twice to unshare) a stock with a contact.
 * The card on the inventory list has no share button after T090+; sharing
 * is edited from the stock detail page via the "Edit" action → StockFormPage
 * → ShareWithSection → ShareModal.
 */
export async function shareStockWith(page, stockKeyOrName, username) {
  await goToStockDetail(page, stockKeyOrName)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.waitForURL(/\/inventory\/\d+\/edit$/)
  // The ShareWithSection header button label is "Share with…" (with the
  // ellipsis). Match it exactly so the "Unshare with <name>" chip remove
  // button — which also contains "share with" — is not selected.
  await page.getByRole('button', { name: 'Share with…', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.locator('li').filter({ hasText: username }).click()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL(/\/inventory\/\d+$/)
}
