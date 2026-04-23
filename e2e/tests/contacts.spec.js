import { test, expect } from '@playwright/test'
import { SEED, loginAsUser1, resetSeed, goToSettings } from './helpers.js'

/**
 * T038 — Contacts management from the Settings page.
 *
 *   · seed contacts (user2 + user3) are rendered on first load.
 *   · search → add → remove roundtrip with the admin user.
 *   · a 1-char query leaves the listbox empty (backend search is
 *     gated at length >= 2 via `useContactSearch`).
 *
 * `resetSeed` in beforeEach guarantees the add/remove roundtrip does
 * not leak into later tests or into other specs that rely on the
 * seed's contact graph (sharing.spec.js).
 */
test.describe('Settings › Contacts', () => {
  test.beforeEach(async ({ page, context }) => {
    await resetSeed(context)
    await loginAsUser1(page)
    await goToSettings(page)
    await expect(page.getByTestId('offline-banner')).toBeHidden()
  })

  test('seeded contacts (user2, user3) appear on first load', async ({ page }) => {
    const list = page.getByTestId('contacts-list')
    await expect(list).toBeVisible()
    await expect(list).toContainText(SEED.user2.username)
    await expect(list).toContainText(SEED.user3.username)
  })

  test('search → add → remove roundtrip with admin', async ({ page }) => {
    const list = page.getByTestId('contacts-list')
    // Sanity: admin is NOT yet a contact.
    await expect(list).not.toContainText(SEED.admin.username)

    // Type at least 2 chars so `useContactSearch` (debounced 300 ms,
    // gated at length >= 2) fires the real request.
    const searchInput = page.getByPlaceholder('Search users...')
    await searchInput.click()
    await searchInput.fill(SEED.admin.username)

    // Listbox opens; the admin user appears as an option. The
    // Combobox uses an `option` role per row.
    const adminOption = page.getByRole('option', { name: SEED.admin.username, exact: true })
    await expect(adminOption).toBeVisible({ timeout: 3_000 })
    await adminOption.click()

    // After the POST the list refetches and admin is in it; the
    // search input is cleared by handleAddContact.
    await expect(list).toContainText(SEED.admin.username)
    await expect(searchInput).toHaveValue('')

    // Remove via the X button on the contact row. The app now surfaces
    // a React-rendered ConfirmModal (no native window.confirm) — confirm
    // inside it to fire the mutation.
    const adminRow = list.getByRole('listitem').filter({ hasText: SEED.admin.username })
    await adminRow.getByRole('button', { name: 'Remove contact', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Remove contact' }).click()

    await expect(list).not.toContainText(SEED.admin.username)
  })

  test('a 1-char query does not trigger the search', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search users...')
    const searchRequests = []
    page.on('request', (req) => {
      if (req.url().includes('/api/auth/users/search/')) searchRequests.push(req.url())
    })

    await searchInput.click()
    await searchInput.fill('u')
    // Past the 300 ms debounce plus a safety margin.
    await page.waitForTimeout(600)

    expect(searchRequests).toEqual([])
    // The listbox also shows zero options in this state.
    await expect(page.getByRole('option')).toHaveCount(0)
  })
})
