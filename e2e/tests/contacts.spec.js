import { test, expect } from '@playwright/test'
import { SEED, loginAsUser1, resetSeed, goToSettings } from './helpers.js'

/**
 * T038 / T197 — Contacts management from the Settings page.
 *
 * Post-T197 contacts are added by exact email (the old user-search
 * autocomplete was removed): type an email → Add. Each row shows the
 * contact's display name plus their email.
 *
 * `resetSeed` in beforeEach guarantees the add/remove roundtrip does not
 * leak into later tests or into specs that rely on the seed contact graph
 * (sharing.spec.js).
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
    await expect(list).toContainText(SEED.user2.email)
    await expect(list).toContainText(SEED.user3.email)
  })

  test('add → remove a contact by email roundtrip', async ({ page }) => {
    const list = page.getByTestId('contacts-list')
    // Sanity: admin is NOT yet a contact.
    await expect(list).not.toContainText(SEED.admin.email)

    // Add admin by exact email; the input clears on success.
    await page.getByTestId('add-contact-email').fill(SEED.admin.email)
    await page.getByTestId('add-contact-submit').click()
    await expect(list).toContainText(SEED.admin.email)
    await expect(page.getByTestId('add-contact-email')).toHaveValue('')

    // Remove via the X button → React ConfirmModal (no native confirm).
    const adminRow = list.getByRole('listitem').filter({ hasText: SEED.admin.email })
    await adminRow.getByRole('button', { name: 'Remove contact', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Remove contact', exact: true }).click()

    await expect(list).not.toContainText(SEED.admin.email)
  })
})
