import { test, expect } from '@playwright/test'
import { SEED, enterEditMode, goToInventory, loginAsUser1, resetSeed } from './helpers.js'

/**
 * T154 — reordering categories without dragging (UX-017): the categories'
 * «Edit» mode shows Up / Down per row. HTML5 drag never worked with a finger
 * on Android and had no keyboard path; this is the only way now.
 *
 * Each test moves categories, so each starts from a fresh seed. Persistence is
 * read from the API, not from a reload: a hard reload within the cache
 * persister's 1 s window can rehydrate the previous snapshot.
 */

const rows = (page) => page.getByTestId('group-row')

async function serverOrder(page) {
  return page.evaluate(async () => {
    const token = localStorage.getItem('access_token')
    const res = await fetch('/api/stock-groups/', { headers: { Authorization: `Bearer ${token}` } })
    const data = await res.json()
    return (data.results ?? data).sort((a, b) => a.display_order - b.display_order).map((g) => g.name)
  })
}

const patched = (page) =>
  page.waitForResponse((r) => /\/stock-groups\/\d+\/$/.test(r.url()) && r.request().method() === 'PATCH')

test.describe('Categories reorder', () => {
  test.beforeEach(async ({ page, context }) => {
    await resetSeed(context)
    await loginAsUser1(page)
    await goToInventory(page)
    await page.getByRole('button', { name: 'Categories' }).click()
    await expect(page).toHaveURL('/inventory/groups')
    await expect(rows(page)).toHaveText(SEED.groupsUser1)
  })

  test('Down and Up move a category and the order is saved', async ({ page }) => {
    await enterEditMode(page)

    let saves = Promise.all([patched(page), patched(page)])
    await page.getByRole('button', { name: 'Move Diabetes down' }).click()
    await saves
    await expect(rows(page)).toHaveText(['Home', 'Diabetes', 'Medicine cabinet', 'Travel'])

    saves = Promise.all([patched(page), patched(page)])
    await page.getByRole('button', { name: 'Move Travel up' }).click()
    await saves
    await expect(rows(page)).toHaveText(['Home', 'Diabetes', 'Travel', 'Medicine cabinet'])

    expect(await serverOrder(page)).toEqual(['Home', 'Diabetes', 'Travel', 'Medicine cabinet'])
  })

  test('the keyboard alone moves a category to the top, the focus staying on it', async ({ page }) => {
    await enterEditMode(page)
    await page.getByRole('button', { name: 'Move Travel up' }).focus()

    for (const expected of [
      ['Diabetes', 'Home', 'Travel', 'Medicine cabinet'],
      ['Diabetes', 'Travel', 'Home', 'Medicine cabinet'],
      ['Travel', 'Diabetes', 'Home', 'Medicine cabinet'],
    ]) {
      const saves = Promise.all([patched(page), patched(page)])
      await page.keyboard.press('Enter')
      await saves
      await expect(rows(page)).toHaveText(expected)
    }

    // At the top its Up is unavailable: the focus is on its Down.
    await expect(page.getByRole('button', { name: 'Move Travel down' })).toBeFocused()
    expect(await serverOrder(page)).toEqual(['Travel', 'Diabetes', 'Home', 'Medicine cabinet'])
  })
})
