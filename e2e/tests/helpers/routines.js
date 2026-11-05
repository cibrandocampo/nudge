import { expect } from '@playwright/test'
import { SEED } from './constants.js'
import { routineCard } from './locators.js'
import { goToRoutineDetail } from './navigation.js'

/**
 * Mark a routine as done from the Dashboard card, by clicking the check on
 * the card's action layer (T101 — the same action as swiping the card right;
 * the swipe itself is covered by routine-swipe.spec.js).
 *
 * The card plays its exit animation before the completion is sent, so the
 * helper waits for the log POST to be answered: a caller that reloads or
 * navigates right after would otherwise abort it.
 * @param {{
 *   expectBlocked?: boolean,
 *   lotNumber?: string,
 * }} opts
 *   - `expectBlocked`: assert the check is disabled (stock-depleted
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
  const logged = page.waitForResponse(
    (r) => /\/routines\/\d+\/log\/$/.test(r.url()) && r.request().method() === 'POST',
  )
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
  await logged
}

/**
 * Drag a routine card horizontally with the mouse, as a finger would swipe
 * it (T103). Pointer Events drive the card's swipe hook either way.
 *
 * The drag starts at the card's centre and covers `fraction` × the card's
 * width (negative goes left), in small timed steps, then holds still briefly
 * before releasing: the hook measures release velocity over the last ~100 ms,
 * so the hold keeps a short drag from counting as a flick. Whether the
 * release commits is therefore decided by the distance alone.
 * @param {{ fraction?: number }} opts
 */
export async function swipeRoutineCard(page, routineKey, { fraction = 0.6 } = {}) {
  const link = routineCard(page, routineKey).getByTestId('routine-card-link')
  await link.scrollIntoViewIfNeeded()
  const box = await link.boundingBox()
  const startX = box.x + box.width / 2
  const y = box.y + box.height / 2
  // Clamp the end inside the viewport so the last moves still land.
  const endX = Math.min(startX + box.width * fraction, page.viewportSize().width - 1)
  const STEPS = 10
  await page.mouse.move(startX, y)
  await page.mouse.down()
  for (let i = 1; i <= STEPS; i++) {
    await page.mouse.move(startX + ((endX - startX) * i) / STEPS, y)
    await page.waitForTimeout(25)
  }
  await page.waitForTimeout(150)
  await page.mouse.up()
}

/**
 * Create a new routine via the `/routines/new` form.
 * @param {{
 *   name: string,
 *   intervalValue?: number,
 *   intervalUnit?: 'hours'|'days'|'weeks'|'months'|'years'
 * }} data
 *   `intervalValue` + `intervalUnit` drive the IntervalPicker (unit
 *   `<select>` + numeric amount input). Omit both to use the default
 *   (Days = 1). The amount input's accessible name follows the selected
 *   unit word (e.g. "weeks").
 */
export async function createRoutine(page, { name, intervalValue, intervalUnit = 'days' }) {
  await page.goto('/routines/new')
  await page.getByPlaceholder(/change water filter/i).fill(name)

  if (intervalValue != null) {
    await page.getByRole('combobox', { name: 'Unit' }).selectOption(intervalUnit)
    await page.getByRole('textbox', { name: intervalUnit }).fill(String(intervalValue))
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
  // T182: routine-detail "Edit" pencil is a `<button>`, not a `<Link>`.
  await page.getByRole('button', { name: 'Edit' }).click()
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
 * Toggle a contact in the routine's share list. The old dashboard-card
 * popover was dropped — sharing is now edited from the routine form
 * (ShareWithSection → ShareModal), matching the stock flow. Works both
 * for share and un-share (toggle semantics); call twice to revert.
 */
export async function shareRoutineWith(page, routineKey, username) {
  await goToRoutineDetail(page, routineKey)
  // T182: routine-detail "Edit" pencil is a `<button>`, not a `<Link>`.
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.waitForURL(/\/routines\/\d+\/edit$/)
  // The ShareWithSection header button label is "Share with…" (with the
  // ellipsis). `exact: true` excludes the per-chip "Unshare with <name>"
  // remove buttons.
  await page.getByRole('button', { name: 'Share with…', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.locator('li').filter({ hasText: username }).click()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL(/\/routines\/\d+$/)
}

export async function unshareRoutineFrom(page, routineKey, username) {
  return shareRoutineWith(page, routineKey, username)
}
