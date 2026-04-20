import { expect } from '@playwright/test'
import { SEED } from './constants.js'
import { routineCard, stockCard } from './locators.js'

export async function goToDashboard(page) {
  // `exact: true` disambiguates from any in-page link that carries the
  // localised nav label as a substring (seen in BottomNav vs page
  // titles).
  await page.getByRole('link', { name: 'Routines', exact: true }).click()
  await page.waitForURL('/')
}

export async function goToInventory(page) {
  await page.getByRole('link', { name: 'Inventory', exact: true }).click()
  await page.waitForURL('/inventory')
}

export async function goToHistory(page) {
  await page.getByRole('link', { name: 'History', exact: true }).click()
  await page.waitForURL('/history')
}

export async function goToSettings(page) {
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.waitForURL('/settings')
}

export async function goToRoutineDetail(page, routineKey) {
  const name = SEED.routines[routineKey] ?? routineKey
  await page.goto('/')
  await routineCard(page, routineKey).first().click()
  await expect(page).toHaveURL(/\/routines\/\d+$/)
  await expect(page.getByText(name).first()).toBeVisible()
}

export async function goToStockDetail(page, stockKey) {
  const name = SEED.stocks[stockKey] ?? stockKey
  await goToInventory(page)
  // Click the explicit "Open details" button instead of the card body:
  // the card's `onClick={goDetail}` handler never fires when the click
  // lands on the `cardActions` row because those children use
  // `onClick={stop}` to guard their own buttons. The open-details
  // chevron button routes via `goDetail` unambiguously.
  await stockCard(page, stockKey).getByRole('button', { name: 'Open details' }).click()
  await expect(page).toHaveURL(/\/inventory\/\d+$/)
  await expect(page.getByText(name).first()).toBeVisible()
}

/**
 * Extract the numeric resource id from the current URL when the page is on
 * `/routines/{id}` or `/inventory/{id}`. Throws if the URL does not match.
 */
export function getCurrentResourceId(page) {
  const match = page.url().match(/\/(routines|inventory)\/(\d+)/)
  if (!match) throw new Error(`URL does not contain a resource id: ${page.url()}`)
  return match[2]
}
