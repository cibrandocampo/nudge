import { test, expect } from '@playwright/test'
import { login, loginAs, CREDS, ensureContact } from './helpers.js'

/**
 * Sharing E2E tests.
 *
 * These tests require TWO users:
 *   - The primary admin user (E2E_USERNAME / E2E_PASSWORD)
 *   - A secondary user  (E2E_USER2_USERNAME / E2E_USER2_PASSWORD)
 *
 * The secondary user must exist in the database before running these tests.
 * The tests will add the secondary user as a contact of the primary user
 * via the API if not already present.
 */

const USER2 = {
  username: process.env.E2E_USER2_USERNAME ?? 'e2e-user2',
  password: process.env.E2E_USER2_PASSWORD ?? 'e2e-pass2',
}

test.describe('Sharing — Routines', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await ensureContact(page, USER2.username)
  })

  test('share popover appears on routine cards', async ({ page }) => {
    // Should be on dashboard after login
    await expect(page.getByText('Today')).toBeVisible()

    // Look for at least one share button (👥) on the page
    const shareButtons = page.getByRole('button', { name: 'Share' })
    const count = await shareButtons.count()

    if (count === 0) {
      // No routines on dashboard — create one first
      await page.getByRole('link', { name: '+ New routine' }).click()
      await page.getByPlaceholder(/change water filter/i).fill(`Share test ${Date.now()}`)
      await page.getByRole('button', { name: 'Save' }).click()
      await page.waitForURL(/\/routines\/\d+$/)

      // Go back to dashboard
      await page.goto('/')
      await expect(page.getByRole('button', { name: 'Share' }).first()).toBeVisible()
    }

    // Click the first share button
    await page.getByRole('button', { name: 'Share' }).first().click()

    // Modal should open with a contact listed
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(USER2.username)).toBeVisible()
  })

  test('share routine via API and verify dashboard reflects it', async ({ page }) => {
    // Create a routine
    await page.getByRole('link', { name: '+ New routine' }).click()
    const routineName = `Shared routine ${Date.now()}`
    await page.getByPlaceholder(/change water filter/i).fill(routineName)
    await page.getByRole('button', { name: 'Save' }).click()
    await page.waitForURL(/\/routines\/\d+$/)

    const routineId = page.url().match(/\/routines\/(\d+)$/)[1]

    // Share via API (the checkbox inside RoutineCard Link causes navigation — known issue)
    await page.evaluate(
      async ({ rid, contactUsername }) => {
        const token = localStorage.getItem('access_token')
        const headers = {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
        const contactsRes = await fetch('/api/auth/contacts/', { headers })
        const contacts = await contactsRes.json()
        const contact = contacts.find((c) => c.username === contactUsername)
        if (!contact) throw new Error(`Contact ${contactUsername} not found`)

        await fetch(`/api/routines/${rid}/`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ shared_with: [contact.id] }),
        })
      },
      { rid: routineId, contactUsername: USER2.username },
    )

    // Go to dashboard and find the specific routine card
    await page.goto('/')
    const card = page.locator('[class*="row"]').filter({ hasText: routineName })
    await expect(card).toBeVisible()

    // Open share modal for this specific routine and verify contact is selected
    await card.getByRole('button', { name: 'Share' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('li').filter({ hasText: USER2.username })).toHaveClass(/itemSelected/)
  })

  test('shared routine visible to second user', async ({ page, context }) => {
    // Create a routine as admin
    await page.getByRole('link', { name: '+ New routine' }).click()
    const routineName = `Visible to user2 ${Date.now()}`
    await page.getByPlaceholder(/change water filter/i).fill(routineName)
    await page.getByRole('button', { name: 'Save' }).click()
    await page.waitForURL(/\/routines\/\d+$/)

    // Share it via API (avoids popover interaction issues inside Link cards)
    const routineId = page.url().match(/\/routines\/(\d+)$/)[1]
    await page.evaluate(
      async ({ rid, contactUsername }) => {
        const token = localStorage.getItem('access_token')
        const headers = {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
        // Get contact ID
        const contactsRes = await fetch('/api/auth/contacts/', { headers })
        const contacts = await contactsRes.json()
        const contact = contacts.find((c) => c.username === contactUsername)
        if (!contact) throw new Error(`Contact ${contactUsername} not found`)

        // Share routine with contact
        await fetch(`/api/routines/${rid}/`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ shared_with: [contact.id] }),
        })
      },
      { rid: routineId, contactUsername: USER2.username },
    )

    // Login as second user in a new page
    const page2 = await context.newPage()
    await loginAs(page2, USER2.username, USER2.password)

    // The shared routine should appear on user2's dashboard
    await expect(page2.getByText(routineName)).toBeVisible({ timeout: 10000 })

    // It should show the owner label (admin username)
    await expect(page2.getByText(CREDS.username).first()).toBeVisible()

    await page2.close()
  })
})

test.describe('Sharing — Inventory', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await ensureContact(page, USER2.username)
    await page.getByRole('link', { name: 'Inventory' }).click()
    await expect(page).toHaveURL('/inventory')
  })

  test('share popover appears on stock cards', async ({ page }) => {
    // Create a stock item first
    const name = `Share stock ${Date.now()}`
    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByPlaceholder(/item name/i).fill(name)
    await page.getByRole('button', { name: 'Create item' }).click()

    const card = page.locator('[data-testid="product-card"]').filter({ hasText: name })
    await expect(card).toBeVisible()

    // Share button should be on the card
    const shareBtn = card.getByTitle('Share with')
    await expect(shareBtn).toBeVisible()

    // Click to open modal
    await shareBtn.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(USER2.username)).toBeVisible()
  })

  test('share stock with contact via popover', async ({ page }) => {
    // Create a stock item
    const name = `Shared stock ${Date.now()}`
    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByPlaceholder(/item name/i).fill(name)
    await page.getByRole('button', { name: 'Create item' }).click()

    const card = page.locator('[data-testid="product-card"]').filter({ hasText: name })
    await expect(card).toBeVisible()

    // Open share modal and select the contact
    await card.getByTitle('Share with').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('li').filter({ hasText: USER2.username })).toBeVisible()
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/stock/') && res.request().method() === 'PATCH'),
      dialog.locator('li').filter({ hasText: USER2.username }).click(),
    ])

    // Close modal with Escape, re-open and verify contact is selected
    await page.keyboard.press('Escape')
    await card.getByTitle('Share with').click()
    const reopened = page.getByRole('dialog')
    await expect(reopened.locator('li').filter({ hasText: USER2.username })).toHaveClass(/itemSelected/)
  })

  test('shared stock visible to second user with owner label', async ({ page, context }) => {
    // Create and share a stock as admin
    const name = `Stock for user2 ${Date.now()}`
    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByPlaceholder(/item name/i).fill(name)
    await page.getByRole('button', { name: 'Create item' }).click()

    const card = page.locator('[data-testid="product-card"]').filter({ hasText: name })
    await expect(card).toBeVisible()

    // Open share modal and wait for PATCH to confirm sharing was saved
    await card.getByTitle('Share with').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('li').filter({ hasText: USER2.username })).toBeVisible()
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/stock/') && res.request().method() === 'PATCH'),
      dialog.locator('li').filter({ hasText: USER2.username }).click(),
    ])

    // Login as second user
    const page2 = await context.newPage()
    await loginAs(page2, USER2.username, USER2.password)
    await page2.getByRole('link', { name: 'Inventory' }).click()
    await expect(page2).toHaveURL('/inventory')

    // The shared stock should appear
    const sharedCard = page2.locator('[data-testid="product-card"]').filter({ hasText: name })
    await expect(sharedCard).toBeVisible({ timeout: 10000 })

    // Owner label should show admin username (scoped to the specific card)
    await expect(sharedCard.getByText(CREDS.username)).toBeVisible()

    // Share button should NOT appear (user2 is not the owner)
    await expect(sharedCard.getByTitle('Share with')).not.toBeVisible()

    await page2.close()
  })
})
