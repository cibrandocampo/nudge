import { expect } from '@playwright/test'
import { SEED } from './constants.js'
import { goToHistory } from './navigation.js'

/**
 * Edit an entry's note inline. `entryLocator` is the listitem returned by
 * `historyEntry(page, filter)` (already filtered to exactly one row).
 */
export async function editEntryNote(page, entryLocator, newNote) {
  await entryLocator.getByRole('button', { name: /edit/i }).click()
  const textarea = entryLocator.getByRole('textbox')
  await textarea.fill(newNote)
  await entryLocator.getByRole('button', { name: /save/i }).click()
  await expect(entryLocator.getByText(newNote)).toBeVisible()
}

/**
 * Apply History page filters. All fields optional.
 * @param {{ routineKey?, stockKey?, dateFrom?: string, dateTo?: string }}
 */
export async function filterHistory(page, { routineKey, stockKey, dateFrom, dateTo } = {}) {
  await goToHistory(page)
  if (routineKey) {
    const name = SEED.routines[routineKey] ?? routineKey
    await page.getByLabel(/routine/i).selectOption({ label: name })
  }
  if (stockKey) {
    const name = SEED.stocks[stockKey] ?? stockKey
    await page.getByLabel(/stock/i).selectOption({ label: name })
  }
  if (dateFrom) await page.getByLabel(/from/i).fill(dateFrom)
  if (dateTo) await page.getByLabel(/to/i).fill(dateTo)
}
