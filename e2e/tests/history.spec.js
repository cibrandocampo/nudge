import { test, expect } from '@playwright/test'
import {
  SEED,
  loginAsUser1,
  goToHistory,
  historyEntry,
  resetSeed,
} from './helpers.js'

/**
 * T035 — History page coverage.
 *
 * One concept per test:
 *   · initial load renders seeded entries.
 *   · the Type filter narrows by record kind.
 *   · the Routine filter restricts to a single routine.
 *   · the Stock filter restricts to a single consumption source.
 *   · inline note edit persists across reload.
 *
 * Entry cards expose `data-testid="history-entry"` with `data-entry-type`
 * ∈ { 'routine', 'consumption' } (added in this task so tests can assert
 * type-scoped visibility without relying on CSS classes).
 */
test.describe('History', () => {
  test.beforeEach(async ({ page, context }) => {
    // Reset so tests don't inherit note edits or notification state from
    // previous specs running in the same global-setup invocation.
    await resetSeed(context)
    await loginAsUser1(page)
    await goToHistory(page)
    // Sanity: at least one entry rendered before the test starts.
    await expect(historyEntry(page).first()).toBeVisible()
  })

  test('initial load shows seed routine entries', async ({ page }) => {
    // Two routines whose entries fall inside the default 15-day filter:
    // `takeAntihistamine` (daily, 14 entries) and `changePumpCannula`
    // (every 3 days, 8 entries). `takeVitaminD` is seeded as overdue
    // with a 28-day interval, so its newest entry sits 35 days ago and
    // would be hidden by the default filter — tested separately in the
    // Routine-filter case below.
    await expect(historyEntry(page, { routineKey: 'takeAntihistamine' }).first()).toBeVisible()
    await expect(historyEntry(page, { routineKey: 'changePumpCannula' }).first()).toBeVisible()
    // Antihistamine entries every 3rd carry `notes="morning dose"` (seed).
    await expect(historyEntry(page, { text: 'morning dose' }).first()).toBeVisible()
  })

  test('type=Routines hides stock consumptions', async ({ page }) => {
    await page.getByLabel('Type', { exact: true }).selectOption({ label: 'Routines' })

    // No consumption-type cards remain; routines still render.
    await expect(historyEntry(page, { type: 'consumption' })).toHaveCount(0)
    await expect(historyEntry(page, { type: 'routine' }).first()).toBeVisible()
  })

  test('type=Stock hides routine entries', async ({ page }) => {
    await page.getByLabel('Type').selectOption({ label: 'Stock' })

    await expect(historyEntry(page, { type: 'routine' })).toHaveCount(0)
    await expect(historyEntry(page, { type: 'consumption' }).first()).toBeVisible()
    // Specific sanity: Hidroferol consumption (seed) is visible.
    await expect(historyEntry(page, { stockKey: 'hidroferol' }).first()).toBeVisible()
  })

  test('Routine filter restricts list to selected routine', async ({ page }) => {
    // The Routine filter only renders when Type=Routines, so flip the
    // type first. The Item/Routine pickers were refactored from native
    // `<select>` to a custom `<Combobox>` (input + listbox); selectOption
    // no longer works — open by clicking the input, then click the
    // matching `<li role="option">`.
    await page.getByLabel('Type', { exact: true }).selectOption({ label: 'Routines' })
    await page.getByPlaceholder('Search routines…').click()
    await page.getByRole('option', { name: SEED.routines.takeAntihistamine }).click()

    // Selects `Take antihistamine` (14 daily entries, all within the
    // default 15-day filter). `takeVitaminD` is overdue with a 28-day
    // interval, so its newest entry is 35d ago — outside the filter.
    // Retry-able settling assertion first — the filter change triggers a
    // TanStack refetch that replaces the list; a raw `.count()` below
    // needs the DOM to have settled.
    await expect(historyEntry(page, { type: 'routine' }).first()).toBeVisible()
    await expect(historyEntry(page, { routineKey: 'changePumpCannula', type: 'routine' })).toHaveCount(0)

    const routineEntries = historyEntry(page, { type: 'routine' })
    const count = await routineEntries.count()
    for (let i = 0; i < count; i += 1) {
      await expect(routineEntries.nth(i)).toContainText(SEED.routines.takeAntihistamine)
    }
  })

  test('Stock filter restricts consumptions to selected stock', async ({ page }) => {
    // Type=Stock reveals the Item Combobox (replaces the native select).
    await page.getByLabel('Type', { exact: true }).selectOption({ label: 'Stock' })
    await page.getByPlaceholder('Search items…').click()
    await page.getByRole('option', { name: SEED.stocks.hidroferol }).click()

    await expect(historyEntry(page, { stockKey: 'hidroferol', type: 'consumption' }).first()).toBeVisible()
    await expect(historyEntry(page, { stockKey: 'pumpCannulas', type: 'consumption' })).toHaveCount(0)

    const consumptions = historyEntry(page, { type: 'consumption' })
    const count = await consumptions.count()
    for (let i = 0; i < count; i += 1) {
      await expect(consumptions.nth(i)).toContainText(SEED.stocks.hidroferol)
    }
  })

  test('inline note edit persists across reload', async ({ page }) => {
    // The note stopped being a hidden click target in T035: it renders as plain
    // text with a pencil beside it, and editing goes through that visible
    // control. This spec still reached for the old `<button>` and had been
    // failing deterministically ever since — fixed in T052.
    const entry = page.getByTestId('history-entry').filter({ hasText: 'morning dose' }).first()
    await expect(entry).toBeVisible()
    await entry.getByTestId('edit-note').click()

    // Not scoped to `entry`: that locator filters on the note's text, and the
    // text becomes an input value the moment the editor opens, so re-resolving
    // it would match nothing. Only one editor can be open at a time.
    const input = page.getByTestId('note-input')
    await input.fill('updated via e2e')
    await input.press('Enter')

    // Brief "Saved" toast after a successful save.
    await expect(page.getByText('Saved').first()).toBeVisible({ timeout: 3_000 })

    await page.reload()
    await expect(page.getByTestId('history-entry').filter({ hasText: 'updated via e2e' }).first()).toBeVisible()
  })
})
