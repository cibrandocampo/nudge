import { expect } from '@playwright/test'
import { SEED } from './constants.js'
import { historyEntry, routineCard, stockCard } from './locators.js'
import { goToInventory, goToSettings, goToStockDetail } from './navigation.js'

/**
 * Assert the visual state of a routine on the Dashboard.
 * @param {'due'|'upcoming'|'blocked'} state
 *   - 'due'      : in the Today section, check enabled.
 *   - 'upcoming' : in the Upcoming section, check enabled (T102: upcoming
 *                  routines can be completed early too).
 *   - 'blocked'  : check visible but disabled (stock-depleted), either section.
 *
 * The check is the button on the card's action layer ("Mark as done"); the
 * `Done` name matches it as a case-insensitive substring.
 */
export async function expectRoutineState(page, routineKey, state) {
  const card = routineCard(page, routineKey)
  const done = card.getByRole('button', { name: 'Done' })
  const inSection = (heading) =>
    page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: heading }) })
      .getByTestId('routine-card')
      .filter({ hasText: SEED.routines[routineKey] ?? routineKey })
  switch (state) {
    case 'due':
      await expect(inSection('Today')).toBeVisible()
      await expect(done).toBeVisible()
      await expect(done).toBeEnabled()
      break
    case 'upcoming':
      await expect(inSection('Upcoming')).toBeVisible()
      await expect(done).toBeVisible()
      await expect(done).toBeEnabled()
      break
    case 'blocked':
      await expect(done).toBeVisible()
      await expect(done).toBeDisabled()
      break
    default:
      throw new Error(`Unknown routine state: ${state}`)
  }
}

/** Assert the number of lot rows on the stock detail page. */
export async function expectLotCount(page, stockKeyOrName, count) {
  await goToStockDetail(page, stockKeyOrName)
  await expect(page.getByTestId('lot-row')).toHaveCount(count)
}

/**
 * Assert the total stock quantity rendered on the inventory card
 * (e.g. "(5 total)"). Accepts a SEED.stocks key or a literal name.
 */
export async function expectStockQuantity(page, stockKeyOrName, total) {
  await goToInventory(page)
  const card = stockCard(page, stockKeyOrName)
  await expect(card).toContainText(new RegExp(`\\(?${total}\\s*total\\)?`))
}

/** Assert that exactly one history entry matching the filter exists. */
export async function expectHistoryEntry(page, filter) {
  await expect(historyEntry(page, filter)).toHaveCount(1)
}

export async function expectInContactList(page, username) {
  await goToSettings(page)
  await expect(page.getByRole('listitem').filter({ hasText: username })).toBeVisible()
}

export async function expectNotInContactList(page, username) {
  await goToSettings(page)
  await expect(page.getByRole('listitem').filter({ hasText: username })).toHaveCount(0)
}

/**
 * Assert the current UI language by checking the bottom-nav Settings link
 * text. 'Settings' / 'Ajustes' / 'Axustes' are all distinct, so one assert
 * disambiguates the three supported locales.
 */
export async function expectLanguage(page, lang) {
  const labels = { en: 'Settings', es: 'Ajustes', gl: 'Axustes' }
  const label = labels[lang]
  if (!label) throw new Error(`Unsupported language: ${lang}`)
  await expect(page.getByRole('link', { name: label })).toBeVisible()
}

/** Assert that a toast with matching text is visible. */
export async function expectToast(page, { text }) {
  const regex = typeof text === 'string' ? new RegExp(text, 'i') : text
  await expect(page.getByRole('status').filter({ hasText: regex })).toBeVisible()
}

/** Wait for a toast to appear. Returns the locator for chaining. */
export async function waitForToast(page, textRegex, { timeout = 3_000 } = {}) {
  const toast = page.getByRole('status').filter({ hasText: textRegex })
  await toast.waitFor({ timeout })
  return toast
}
