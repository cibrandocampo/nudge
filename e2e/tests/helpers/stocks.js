import { expect } from '@playwright/test'
import { SEED } from './constants.js'
import { stockCard } from './locators.js'
import { goToInventory, goToStockDetail } from './navigation.js'

export async function createStock(page, { name }) {
  await goToInventory(page)
  await page.getByRole('button', { name: '+ New' }).click()
  await page.getByPlaceholder(/item name/i).fill(name)
  await page.getByRole('button', { name: 'Create item' }).click()
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

export async function shareStockWith(page, stockKeyOrName, username) {
  await goToInventory(page)
  const card = stockCard(page, stockKeyOrName)
  await card.getByTitle('Share with').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.locator('li').filter({ hasText: username }).click()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
}
