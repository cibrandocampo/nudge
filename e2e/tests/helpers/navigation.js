import { expect } from '@playwright/test'
import { SEED } from './constants.js'
import { routineCard, stockCard } from './locators.js'

// The bottom bar is the app's only <nav>. Its links are found by destination,
// not by label: since T148 a Spanish or Galician profile shows its own
// language from sign-in, so 'Settings' is 'Ajustes' or 'Axustes'.
export const navLink = (page, path) => page.locator(`nav a[href="${path}"]`)

export async function goToDashboard(page) {
  await navLink(page, '/').click()
  await page.waitForURL('/')
}

/**
 * Open the inventory. It opens on Featured (T204), so by default this moves to
 * All, where every product can be found; `{ filter: null }` leaves the view as
 * it opened, for specs about that view.
 */
export async function goToInventory(page, { filter = 'all' } = {}) {
  await navLink(page, '/inventory').click()
  await page.waitForURL('/inventory')
  if (!filter) return
  const chip = page.locator(`[data-testid="stock-filter-chip"][data-chip="${filter}"]`)
  // An empty inventory has no filters to choose from.
  await expect(chip.or(page.getByTestId('empty-card')).first()).toBeVisible()
  if ((await chip.count()) > 0 && (await chip.getAttribute('data-active')) === null) await chip.click()
}

export async function goToHistory(page) {
  await navLink(page, '/history').click()
  await page.waitForURL('/history')
}

export async function goToSettings(page) {
  await navLink(page, '/settings').click()
  await page.waitForURL('/settings')
}

export async function goToRoutineDetail(page, routineKey) {
  const name = SEED.routines[routineKey] ?? routineKey
  // Client-side, through the bottom bar — not `page.goto('/')`. A hard reload
  // within the persister's 1 s window after a write rehydrates the previous
  // snapshot as fresh: unshare.spec saved the share, reloaded here, and the
  // form then sent the pre-share `updated_at` and got a 412.
  await goToDashboard(page)
  await routineCard(page, routineKey).first().click()
  await expect(page).toHaveURL(/\/routines\/\d+$/)
  await expect(page.getByText(name).first()).toBeVisible()
}

export async function goToStockDetail(page, stockKey) {
  const name = SEED.stocks[stockKey] ?? stockKey
  await goToInventory(page)
  // Click the explicit "Open details" button instead of the row body: the
  // row's `onClick={goDetail}` handler never fires when the click lands on
  // the actions group, because those children use `onClick={stop}` to guard
  // their own buttons. The open-details chevron routes via `goDetail`
  // unambiguously.

  await stockCard(page, stockKey).first().getByTestId('row-open-detail').click()
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

/**
 * Choose an item of a detail page's «More» menu (T152): history, delete,
 * deactivate live there now. By test id, so it works in any session
 * language (user2/user3 are not English, T148).
 * @param {'menu-history'|'menu-delete'|'menu-toggle-active'} itemTestId
 */
export async function chooseFromMoreMenu(page, itemTestId) {
  await page.getByTestId('more-menu').click()
  await page.getByTestId(itemTestId).click()
}

/**
 * Enter a list section's «Edit» mode (T153): the per-row delete buttons
 * (`row-delete`) only exist in it. One toggle per page today (a product's
 * lots, Settings' contacts), so by test id.
 */
export async function enterEditMode(page) {
  await page.getByTestId('edit-toggle').click()
}
