import { expect } from '@playwright/test'
import { SEED } from './constants.js'
import { routineCard } from './locators.js'

/**
 * Mark a routine as done from the Dashboard card.
 * @param {{
 *   expectBlocked?: boolean,
 *   lotNumber?: string,
 * }} opts
 *   - `expectBlocked`: assert the Done button is disabled (stock-depleted
 *     routines should block completion) and skip the click.
 *   - `lotNumber`: when the routine has `requires_lot_selection=true`
 *     the UI opens a LotSelectionModal; the helper picks the lot whose
 *     row contains `lotNumber` and confirms.
 */
export async function markRoutineDone(page, routineKey, { expectBlocked = false, lotNumber } = {}) {
  const card = routineCard(page, routineKey)
  const done = card.getByRole('button', { name: 'Done' })
  if (expectBlocked) {
    await expect(done).toBeDisabled()
    return
  }
  await done.click()

  if (lotNumber) {
    // LotSelectionModal is a `role="dialog"` with each lot rendered as a
    // `role="radio"` row containing the lot_number text.
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('radio').filter({ hasText: lotNumber }).click()
    await dialog.getByRole('button', { name: /confirm|done/i }).click()
    await expect(dialog).toBeHidden()
  }
}

/**
 * Create a new routine via the `/routines/new` form.
 * @param {{
 *   name: string,
 *   intervalValue?: number,
 *   intervalUnit?: 'hours'|'days'|'weeks'|'months'|'years'
 * }} data
 *   `intervalValue` + `intervalUnit` drive the IntervalPicker (segmented
 *   unit tab + stepper). Omit both to use the default (Days = 1).
 */
export async function createRoutine(page, { name, intervalValue, intervalUnit = 'days' }) {
  await page.goto('/routines/new')
  await page.getByPlaceholder(/change water filter/i).fill(name)

  if (intervalValue != null) {
    await page.getByRole('tab', { name: intervalUnit }).click()
    // Stepper defaults to value=1 after switching units; step up to target.
    const increase = page.getByRole('button', { name: 'Increase' })
    for (let i = 1; i < Math.max(1, intervalValue); i += 1) {
      await increase.click()
    }
  }

  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL(/\/routines\/\d+$/)
}

/**
 * Rename an existing routine from its detail page.
 * Accepts a `SEED.routines` key or a literal routine name.
 */
export async function renameRoutine(page, routineKeyOrName, newName) {
  const current = SEED.routines[routineKeyOrName] ?? routineKeyOrName
  await page.goto('/')
  await page.getByRole('link', { name: current }).first().click()
  await page.waitForURL(/\/routines\/\d+$/)
  await page.getByRole('link', { name: 'Edit' }).click()
  const nameInput = page.getByPlaceholder(/change water filter/i)
  await nameInput.clear()
  await nameInput.fill(newName)
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL(/\/routines\/\d+$/)
  await expect(page.getByText(newName).first()).toBeVisible()
}

/**
 * Delete a routine from its detail page and confirm the modal. Navigates
 * back to the dashboard on success.
 */
export async function deleteRoutine(page, routineKeyOrName) {
  const name = SEED.routines[routineKeyOrName] ?? routineKeyOrName
  await page.goto('/')
  await page.getByRole('link', { name }).first().click()
  await page.waitForURL(/\/routines\/\d+$/)
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Delete' }).last().click()
  await page.waitForURL('/')
}

/**
 * Toggle a contact in the share popover of a routine on the Dashboard.
 * Opens the popover, clicks the contact row and closes it. Works both for
 * share and un-share — the popover is a checkbox-style toggle.
 */
export async function shareRoutineWith(page, routineKey, username) {
  const card = routineCard(page, routineKey)
  await card.getByRole('button', { name: 'Share' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.locator('li').filter({ hasText: username }).click()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
}

export async function unshareRoutineFrom(page, routineKey, username) {
  return shareRoutineWith(page, routineKey, username)
}
